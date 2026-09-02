import { describe, expect, it } from 'vitest';

import {
  getChatViewIdentityKey,
  getCompletionSessionIdentity,
  getRealtimeMessageProvider,
  getTerminalTranscriptIdentity,
  realtimeMessageMatchesSession,
  realtimeMessageMatchesView,
  resolveChatViewContinuity,
  resolveActiveSessionId,
  shouldAdoptCreatedSession,
  shouldAlignViewWithSession,
  shouldPropagateProcessingState,
  shouldPreserveLiveSessionOnRefresh,
  shouldShowConnectionRecoveryStatus,
} from './sessionRealtimeIdentity';

describe('session realtime identity', () => {
  it('gives every project/provider/session view its own component identity', () => {
    const codexView = getChatViewIdentityKey({
      projectKey: '/workspace/research',
      sessionId: 'shared-id',
      provider: 'codex',
    });
    const claudeView = getChatViewIdentityKey({
      projectKey: '/workspace/research',
      sessionId: 'shared-id',
      provider: 'claude',
    });
    const otherProjectView = getChatViewIdentityKey({
      projectKey: '/workspace/other',
      sessionId: 'shared-id',
      provider: 'codex',
    });

    expect(codexView).not.toBe(claudeView);
    expect(codexView).not.toBe(otherProjectView);
    expect(getChatViewIdentityKey({ projectKey: '/workspace/research' }))
      .toBe('["/workspace/research","draft","draft:initial"]');
  });

  it('keeps one draft surface while temporary ids and providers are assigned', () => {
    const emptyDraft = getChatViewIdentityKey({
      projectKey: 'project-a',
    });
    const temporaryCodexDraft = getChatViewIdentityKey({
      projectKey: 'project-a',
      sessionId: 'new-session-123',
      provider: 'codex',
    });
    const temporaryClaudeDraft = getChatViewIdentityKey({
      projectKey: 'project-a',
      sessionId: 'temp-456',
      provider: 'claude',
    });

    expect(temporaryCodexDraft).toBe(emptyDraft);
    expect(temporaryClaudeDraft).toBe(emptyDraft);
  });

  it('creates a fresh draft surface for every explicit new-chat request', () => {
    const firstDraft = getChatViewIdentityKey({
      projectKey: 'project-a',
      draftRequestKey: 1,
    });
    const secondDraft = getChatViewIdentityKey({
      projectKey: 'project-a',
      draftRequestKey: 2,
    });
    const promotedTemporaryDraft = getChatViewIdentityKey({
      projectKey: 'project-a',
      sessionId: 'new-session-123',
      provider: 'codex',
      draftRequestKey: 2,
    });

    expect(secondDraft).not.toBe(firstDraft);
    expect(promotedTemporaryDraft).toBe(secondDraft);
  });

  it('keeps the draft chat mounted when its temporary identity is promoted', () => {
    const draft = resolveChatViewContinuity({
      projectKey: 'project-a',
      draftRequestKey: 2,
    });
    const promoted = resolveChatViewContinuity({
      previous: draft.state,
      projectKey: 'project-a',
      sessionId: 'real-session-1',
      provider: 'codex',
      draftRequestKey: 2,
      isDraftPromotion: true,
    });
    const afterFirstResponse = resolveChatViewContinuity({
      previous: promoted.state,
      projectKey: 'project-a',
      sessionId: 'real-session-1',
      provider: 'codex',
      draftRequestKey: 2,
    });

    expect(promoted.key).toBe(draft.key);
    expect(afterFirstResponse.key).toBe(draft.key);
  });

  it('keeps the first message mounted while its draft gets a real project', () => {
    const virtualDraft = resolveChatViewContinuity({
      projectKey: 'default-conversation',
      draftRequestKey: 3,
    });
    const allocatedProject = resolveChatViewContinuity({
      previous: virtualDraft.state,
      projectKey: 'conversation-2026-09-02',
      draftRequestKey: 3,
      isDraftProjectPromotion: true,
    });
    const promotedSession = resolveChatViewContinuity({
      previous: allocatedProject.state,
      projectKey: 'conversation-2026-09-02',
      sessionId: 'real-session-1',
      provider: 'pi',
      draftRequestKey: 3,
      isDraftPromotion: true,
    });

    expect(allocatedProject.key).toBe(virtualDraft.key);
    expect(promotedSession.key).toBe(virtualDraft.key);
  });

  it('can promote a draft session across the project allocation boundary', () => {
    const virtualDraft = resolveChatViewContinuity({
      projectKey: 'default-conversation',
    });
    const promoted = resolveChatViewContinuity({
      previous: virtualDraft.state,
      projectKey: 'conversation-2026-09-02',
      sessionId: 'real-session-1',
      provider: 'codex',
      isDraftPromotion: true,
    });

    expect(promoted.key).toBe(virtualDraft.key);
  });

  it('still remounts when the user opens a different real conversation', () => {
    const draft = resolveChatViewContinuity({ projectKey: 'project-a' });
    const promoted = resolveChatViewContinuity({
      previous: draft.state,
      projectKey: 'project-a',
      sessionId: 'real-session-1',
      provider: 'claude',
      isDraftPromotion: true,
    });
    const selectedAnotherSession = resolveChatViewContinuity({
      previous: promoted.state,
      projectKey: 'project-a',
      sessionId: 'real-session-2',
      provider: 'claude',
    });

    expect(selectedAnotherSession.key).not.toBe(promoted.key);
    expect(selectedAnotherSession.key).toContain('real-session-2');
  });

  it('keeps the explicit sidebar selection authoritative while another turn is processing', () => {
    expect(resolveActiveSessionId({
      isProcessing: true,
      currentSessionId: 'codex-live',
      selectedSessionId: 'claude-stale',
    })).toBe('claude-stale');
  });

  it('keeps a real Claude selection authoritative over a stale pending Codex turn', () => {
    const activeSessionId = resolveActiveSessionId({
      isProcessing: true,
      currentSessionId: 'codex-live',
      selectedSessionId: 'claude-selected',
      pendingSessionId: 'codex-live',
    });

    expect(activeSessionId).toBe('claude-selected');
    expect(realtimeMessageMatchesView({
      type: 'codex-response',
      sessionId: 'codex-live',
      data: { type: 'item' },
    }, {
      activeSessionId,
      activeProvider: 'claude',
    })).toBe(false);
  });

  it('prefers a pending draft turn until its real session is selected', () => {
    expect(resolveActiveSessionId({
      isProcessing: true,
      currentSessionId: null,
      selectedSessionId: null,
      pendingSessionId: 'new-session-1',
      promotedSessionIds: new Map([['new-session-1', 'claude-live']]),
    })).toBe('claude-live');
  });

  it('prefers the sidebar selection while idle', () => {
    expect(resolveActiveSessionId({
      isProcessing: false,
      currentSessionId: 'previous-session',
      selectedSessionId: 'selected-session',
    })).toBe('selected-session');
  });

  it('does not mark a newly selected session active from the previous view loading frame', () => {
    expect(shouldPropagateProcessingState({
      isProcessing: true,
      currentSessionId: 'codex-live',
      selectedSessionId: 'claude-selected',
    })).toBe(false);

    expect(shouldPropagateProcessingState({
      isProcessing: true,
      currentSessionId: 'claude-selected',
      selectedSessionId: 'claude-selected',
    })).toBe(true);

    expect(shouldPropagateProcessingState({
      isProcessing: true,
      currentSessionId: 'new-session-1',
      selectedSessionId: 'new-session-1',
    })).toBe(true);
  });

  it('does not label a freshly submitted turn as connection recovery', () => {
    expect(shouldShowConnectionRecoveryStatus({
      isProcessing: true,
      socketAvailable: false,
      localTurnAwaitingBackend: true,
    })).toBe(false);

    expect(shouldShowConnectionRecoveryStatus({
      isProcessing: true,
      socketAvailable: false,
      localTurnAwaitingBackend: false,
    })).toBe(true);

    expect(shouldShowConnectionRecoveryStatus({
      isProcessing: true,
      socketAvailable: true,
      localTurnAwaitingBackend: false,
    })).toBe(false);
  });

  it('does not match a background completion to a different selected conversation', () => {
    const promoted = new Map([['new-session-1', 'codex-live']]);
    const activeSessionId = resolveActiveSessionId({
      isProcessing: true,
      currentSessionId: 'new-session-1',
      selectedSessionId: 'claude-stale',
      promotedSessionIds: promoted,
    });

    expect(realtimeMessageMatchesSession({
      type: 'codex-complete',
      sessionId: 'provisional',
      actualSessionId: 'codex-live',
    }, activeSessionId, promoted)).toBe(false);
  });

  it('keeps provider status isolated even when session state is changing', () => {
    expect(getRealtimeMessageProvider({
      type: 'session-status',
      sessionId: 'visible-session',
      provider: 'codex',
      isProcessing: true,
    })).toBe('codex');

    expect(realtimeMessageMatchesView({
      type: 'session-status',
      sessionId: 'visible-session',
      provider: 'codex',
      isProcessing: true,
    }, {
      activeSessionId: 'visible-session',
      activeProvider: 'claude',
    })).toBe(false);

    expect(realtimeMessageMatchesView({
      type: 'session-status',
      sessionId: 'visible-session',
      provider: 'claude',
      isProcessing: false,
    }, {
      activeSessionId: 'visible-session',
      activeProvider: 'claude',
    })).toBe(true);
  });

  it('extracts provider and authoritative completion id', () => {
    expect(getCompletionSessionIdentity({
      type: 'claude-complete',
      sessionId: 'claude-live',
    })).toEqual({
      sessionId: 'claude-live',
      provider: 'claude',
      runtimeId: 'claude',
      projectKey: null,
    });
    expect(getCompletionSessionIdentity({
      type: 'codex-complete',
      sessionId: 'temporary',
      actualSessionId: 'codex-live',
    })).toEqual({
      sessionId: 'codex-live',
      provider: 'codex',
      runtimeId: 'codex',
      projectKey: null,
    });
  });

  it('keeps identical runtime session ids isolated by project', () => {
    expect(realtimeMessageMatchesView({
      type: 'session-status',
      runtimeId: 'codex',
      projectKey: 'project-b',
      sessionId: 'shared-session',
      isProcessing: true,
    }, {
      activeSessionId: 'shared-session',
      activeRuntimeId: 'codex',
      activeProjectKey: 'project-a',
    })).toBe(false);

    expect(realtimeMessageMatchesView({
      type: 'session-status',
      runtimeId: 'codex',
      projectKey: 'project-a',
      sessionId: 'shared-session',
      isProcessing: true,
    }, {
      activeSessionId: 'shared-session',
      activeRuntimeId: 'codex',
      activeProjectKey: 'project-a',
    })).toBe(true);
  });

  it('preserves a draft live id across reconnects but never overrides a real selection', () => {
    expect(shouldPreserveLiveSessionOnRefresh({
      isProcessing: true,
      currentSessionId: 'codex-live',
      selectedSessionId: null,
      selectionChanged: false,
    })).toBe(true);
    expect(shouldPreserveLiveSessionOnRefresh({
      isProcessing: true,
      currentSessionId: 'codex-live',
      selectedSessionId: 'another-session',
      selectionChanged: false,
    })).toBe(false);
  });

  it('never aligns a background terminal event over a different real selection', () => {
    expect(shouldAlignViewWithSession({
      targetSessionId: 'background-session',
      currentSessionId: 'background-session',
      selectedSessionId: 'visible-session',
    })).toBe(false);

    expect(shouldAlignViewWithSession({
      targetSessionId: 'created-session',
      currentSessionId: 'new-session-1',
      selectedSessionId: null,
    })).toBe(true);
  });

  it('only adopts session-created events owned by the current draft or selection', () => {
    expect(shouldAdoptCreatedSession({
      currentSessionId: null,
      selectedSessionId: 'visible-session',
      pendingSessionId: 'new-session-1',
      previousSessionId: 'new-session-1',
      hasPendingView: true,
    })).toBe(false);

    expect(shouldAdoptCreatedSession({
      currentSessionId: 'new-session-1',
      selectedSessionId: null,
      pendingSessionId: 'new-session-1',
      previousSessionId: 'new-session-1',
      hasPendingView: true,
    })).toBe(true);
  });

  it('treats provider-native terminal events as transcript completion signals', () => {
    expect(getTerminalTranscriptIdentity({
      type: 'codex-response',
      sessionId: 'codex-live',
      data: { type: 'turn_complete' },
    }, {
      fallbackProvider: 'claude',
    })).toEqual({ sessionId: 'codex-live', provider: 'codex' });

    expect(getTerminalTranscriptIdentity({
      type: 'claude-response',
      sessionId: 'claude-live',
      data: { type: 'result' },
    }, {
      fallbackProvider: 'codex',
    })).toEqual({ sessionId: 'claude-live', provider: 'claude' });
  });

  it('uses an inactive status response as the reconnect completion fallback', () => {
    expect(getTerminalTranscriptIdentity({
      type: 'session-status',
      sessionId: 'codex-live',
      provider: 'codex',
      isProcessing: false,
    }, {
      currentSessionId: 'codex-live',
      selectedSessionId: 'stale-claude-selection',
      fallbackProvider: 'claude',
    })).toEqual({ sessionId: 'codex-live', provider: 'codex' });

    expect(getTerminalTranscriptIdentity({
      type: 'session-status',
      sessionId: 'codex-live',
      provider: 'codex',
      isProcessing: true,
    }, {
      fallbackProvider: 'claude',
    })).toBeNull();
  });
});
