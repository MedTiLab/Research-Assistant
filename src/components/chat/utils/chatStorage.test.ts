import { describe, expect, it } from 'vitest';

import {
  getChatMessagesStorageKey,
  getPendingSessionStorageKey,
  parseChatMessagesCache,
  serializeChatMessagesCache,
} from './chatStorage';

describe('chat message storage scope', () => {
  it('isolates cached transcripts by project, provider, and session', () => {
    expect(getChatMessagesStorageKey({
      projectName: 'project-a',
      provider: 'claude',
      sessionId: 'session-1',
    })).toBe('chat_messages_project-a:claude:session-1');

    expect(getChatMessagesStorageKey({
      projectName: 'project-a',
      provider: 'codex',
      sessionId: 'session-1',
    })).not.toBe(getChatMessagesStorageKey({
      projectName: 'project-a',
      provider: 'claude',
      sessionId: 'session-1',
    }));
  });

  it('keeps a project draft separate from every persisted session', () => {
    expect(getChatMessagesStorageKey({ projectName: 'project-a' }))
      .toBe('chat_messages_project-a:draft');
  });

  it('accepts only a cache envelope owned by the exact view identity', () => {
    const identity = {
      projectName: 'project-a',
      provider: 'codex',
      sessionId: 'session-1',
    };
    const raw = serializeChatMessagesCache(identity, [{ type: 'assistant', content: 'codex' }]);

    expect(parseChatMessagesCache(raw, identity)).toEqual([
      { type: 'assistant', content: 'codex' },
    ]);
    expect(parseChatMessagesCache(raw, { ...identity, provider: 'claude' })).toBeNull();
    expect(parseChatMessagesCache(raw, { ...identity, sessionId: 'session-2' })).toBeNull();
  });

  it('rejects legacy unowned caches for persisted sessions', () => {
    const legacy = JSON.stringify([{ type: 'assistant', content: 'possibly contaminated' }]);

    expect(parseChatMessagesCache(legacy, {
      projectName: 'project-a',
      provider: 'codex',
      sessionId: 'session-1',
    })).toBeNull();
    expect(parseChatMessagesCache(legacy, {
      projectName: 'project-a',
    })).toEqual([{ type: 'assistant', content: 'possibly contaminated' }]);
  });

  it('keeps pending draft promotion scoped to its provider', () => {
    expect(getPendingSessionStorageKey('claude')).toBe('chat_pending_session_claude');
    expect(getPendingSessionStorageKey('codex')).toBe('chat_pending_session_codex');
    expect(getPendingSessionStorageKey('claude')).not.toBe(getPendingSessionStorageKey('codex'));
  });
});
