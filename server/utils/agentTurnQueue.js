import { getRequiredAgentRuntime } from '../agent-runtime/registry.js';
import {
  createAgentSessionKey,
  isTemporaryAgentSessionId,
  normalizeRuntimeId,
} from './agentSessionIdentity.js';

function normalizeId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function publicItem(item) {
  return {
    id: item.id,
    content: item.content,
    attachments: Array.isArray(item.attachments) ? item.attachments : [],
    createdAt: item.createdAt,
  };
}

function payloadSessionIds(payload) {
  return [
    payload?.sessionId,
    payload?.clientSessionId,
    payload?.options?.sessionId,
    payload?.options?.clientSessionId,
  ].map(normalizeId).filter(Boolean);
}

function payloadProjectKey(payload) {
  return normalizeId(
    payload?.projectKey
    ?? payload?.options?.projectKey
    ?? payload?.options?.projectName
    ?? payload?.options?.projectPath
    ?? payload?.options?.cwd,
  );
}

function resolveRuntimeId(runtimeId, provider) {
  return normalizeRuntimeId(runtimeId ?? provider);
}

function requireQueueRuntime(runtimeId) {
  const normalizedRuntimeId = resolveRuntimeId(runtimeId);
  return getRequiredAgentRuntime(normalizedRuntimeId, { capability: 'turnQueue' });
}

export class AgentTurnQueueRegistry {
  constructor() {
    this.aliases = new Map();
  }

  aliasKey(ownerKey, runtimeId, projectKey, sessionId) {
    return createAgentSessionKey({ ownerKey, projectKey, runtimeId, sessionId });
  }

  find(ownerKey, runtimeId, sessionId, projectKey = null) {
    const normalizedSessionId = normalizeId(sessionId);
    const normalizedRuntimeId = resolveRuntimeId(runtimeId);
    const normalizedProjectKey = normalizeId(projectKey);
    if (!normalizedSessionId || !normalizedRuntimeId) return null;

    if (normalizedProjectKey) {
      return this.aliases.get(this.aliasKey(
        ownerKey,
        normalizedRuntimeId,
        normalizedProjectKey,
        normalizedSessionId,
      )) || null;
    }

    // Compatibility for an older client that did not send projectKey. It is
    // safe only when the remaining composite identity has one unique match.
    const matches = new Set();
    for (const state of this.aliases.values()) {
      if (
        state.ownerKey === ownerKey
        && state.runtimeId === normalizedRuntimeId
        && state.aliases.has(normalizedSessionId)
      ) {
        matches.add(state);
      }
    }
    return matches.size === 1 ? [...matches][0] : null;
  }

  findFromPayload(ownerKey, runtimeId, payload) {
    const projectKey = payloadProjectKey(payload);
    for (const sessionId of payloadSessionIds(payload)) {
      const state = this.find(ownerKey, runtimeId, sessionId, projectKey);
      if (state) return state;
    }
    return null;
  }

  createState({ ownerKey, runtimeId, provider, projectKey, payload, writer, dispatch }) {
    const normalizedRuntimeId = resolveRuntimeId(runtimeId, provider);
    requireQueueRuntime(normalizedRuntimeId);
    const normalizedProjectKey = normalizeId(projectKey) || payloadProjectKey(payload);
    const state = {
      ownerKey,
      projectKey: normalizedProjectKey,
      runtimeId: normalizedRuntimeId,
      writer,
      dispatch,
      aliases: new Set(),
      sessionId: null,
      running: false,
      items: [],
      drainScheduled: false,
    };
    this.addPayloadAliases(state, payload);
    return state;
  }

  addAlias(state, sessionId) {
    const normalizedSessionId = normalizeId(sessionId);
    if (!normalizedSessionId) return;
    const key = this.aliasKey(
      state.ownerKey,
      state.runtimeId,
      state.projectKey,
      normalizedSessionId,
    );
    state.aliases.add(normalizedSessionId);
    this.aliases.set(key, state);
    if (!isTemporaryAgentSessionId(normalizedSessionId)) {
      state.sessionId = normalizedSessionId;
    } else if (!state.sessionId) {
      state.sessionId = normalizedSessionId;
    }
  }

  addPayloadAliases(state, payload) {
    payloadSessionIds(payload).forEach((sessionId) => this.addAlias(state, sessionId));
  }

  begin({ ownerKey, runtimeId, provider, projectKey, payload, writer, dispatch }) {
    const normalizedRuntimeId = resolveRuntimeId(runtimeId, provider);
    requireQueueRuntime(normalizedRuntimeId);
    const normalizedProjectKey = normalizeId(projectKey) || payloadProjectKey(payload);
    const state = this.findFromPayload(ownerKey, normalizedRuntimeId, payload)
      || this.createState({
        ownerKey,
        runtimeId: normalizedRuntimeId,
        projectKey: normalizedProjectKey,
        payload,
        writer,
        dispatch,
      });
    state.writer = writer || state.writer;
    state.dispatch = dispatch || state.dispatch;
    state.running = true;
    this.addPayloadAliases(state, payload);
    return state;
  }

  resolveSession(state, sessionId) {
    if (!state) return;
    const previousSessionId = state.sessionId;
    this.addAlias(state, sessionId);
    if (state.sessionId && state.sessionId !== previousSessionId) {
      this.emitSnapshot(state);
    }
  }

  enqueue({ ownerKey, runtimeId, provider, projectKey, sessionId, item, writer, dispatch }) {
    const normalizedRuntimeId = resolveRuntimeId(runtimeId, provider);
    requireQueueRuntime(normalizedRuntimeId);
    const normalizedProjectKey = normalizeId(projectKey) || payloadProjectKey(item?.payload);
    const normalizedItemId = normalizeId(item?.id);
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if (!normalizedItemId || !content || !item?.payload) {
      throw new Error('Invalid queued message.');
    }

    let state = this.find(ownerKey, normalizedRuntimeId, sessionId, normalizedProjectKey)
      || this.findFromPayload(ownerKey, normalizedRuntimeId, item.payload);
    if (!state) {
      state = this.createState({
        ownerKey,
        runtimeId: normalizedRuntimeId,
        projectKey: normalizedProjectKey,
        payload: item.payload,
        writer,
        dispatch,
      });
    }
    state.writer = state.writer || writer;
    state.dispatch = state.dispatch || dispatch;
    this.addAlias(state, sessionId);
    this.addPayloadAliases(state, item.payload);

    if (state.items.some((queuedItem) => queuedItem.id === normalizedItemId)) {
      return state;
    }

    state.items.push({
      id: normalizedItemId,
      content,
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      commandPrefix: typeof item.commandPrefix === 'string' ? item.commandPrefix : '',
      commandSuffix: typeof item.commandSuffix === 'string' ? item.commandSuffix : '',
      payload: item.payload,
    });
    this.emitSnapshot(state);
    this.scheduleDrain(state);
    return state;
  }

  update({ ownerKey, runtimeId, provider, projectKey, sessionId, itemId, content }) {
    const state = this.find(ownerKey, resolveRuntimeId(runtimeId, provider), sessionId, projectKey);
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    if (!state || !normalizedContent) return false;
    const item = state.items.find((queuedItem) => queuedItem.id === itemId);
    if (!item) return false;
    item.content = normalizedContent;
    item.payload = {
      ...item.payload,
      command: `${item.commandPrefix}${normalizedContent}${item.commandSuffix}`,
      visibleUserContent: normalizedContent,
    };
    this.emitSnapshot(state);
    return true;
  }

  remove({ ownerKey, runtimeId, provider, projectKey, sessionId, itemId }) {
    const state = this.find(ownerKey, resolveRuntimeId(runtimeId, provider), sessionId, projectKey);
    if (!state) return false;
    const previousLength = state.items.length;
    state.items = state.items.filter((item) => item.id !== itemId);
    if (state.items.length === previousLength) return false;
    this.emitSnapshot(state);
    this.cleanup(state);
    return true;
  }

  reorder({ ownerKey, runtimeId, provider, projectKey, sessionId, itemIds }) {
    const state = this.find(ownerKey, resolveRuntimeId(runtimeId, provider), sessionId, projectKey);
    if (!state || !Array.isArray(itemIds)) return false;
    const byId = new Map(state.items.map((item) => [item.id, item]));
    const ordered = [];
    for (const itemId of itemIds) {
      const item = byId.get(itemId);
      if (!item) continue;
      ordered.push(item);
      byId.delete(itemId);
    }
    ordered.push(...byId.values());
    state.items = ordered;
    this.emitSnapshot(state);
    return true;
  }

  clear({ ownerKey, runtimeId, provider, projectKey, sessionId }) {
    const state = this.find(ownerKey, resolveRuntimeId(runtimeId, provider), sessionId, projectKey);
    if (!state) return false;
    state.items = [];
    this.emitSnapshot(state);
    this.cleanup(state);
    return true;
  }

  snapshot({ ownerKey, runtimeId, provider, projectKey, sessionId, writer }) {
    const normalizedRuntimeId = resolveRuntimeId(runtimeId, provider);
    requireQueueRuntime(normalizedRuntimeId);
    const state = this.find(ownerKey, normalizedRuntimeId, sessionId, projectKey);
    if (!state) {
      writer?.send?.({
        type: 'agent-turn-queue-updated',
        runtimeId: normalizedRuntimeId,
        provider: normalizedRuntimeId,
        projectKey: normalizeId(projectKey),
        sessionId,
        items: [],
      });
      return [];
    }
    this.emitSnapshot(state, writer);
    return state.items.map(publicItem);
  }

  complete(state, resolvedSessionId) {
    if (!state) return;
    this.resolveSession(state, resolvedSessionId);
    state.running = false;
    this.scheduleDrain(state);
    this.cleanup(state);
  }

  emitSnapshot(state, targetWriter = state.writer) {
    targetWriter?.send?.({
      type: 'agent-turn-queue-updated',
      runtimeId: state.runtimeId,
      provider: state.runtimeId,
      projectKey: state.projectKey,
      sessionId: state.sessionId || [...state.aliases][0] || null,
      items: state.items.map(publicItem),
    });
  }

  scheduleDrain(state) {
    if (state.running || state.drainScheduled || state.items.length === 0) return;
    state.drainScheduled = true;
    queueMicrotask(() => {
      state.drainScheduled = false;
      this.drain(state);
    });
  }

  drain(state) {
    if (state.running || state.items.length === 0) return;
    const item = state.items.shift();
    state.running = true;
    const resolvedSessionId = state.sessionId;
    const canResume = resolvedSessionId && !isTemporaryAgentSessionId(resolvedSessionId);
    const payload = {
      ...item.payload,
      runtimeId: state.runtimeId,
      projectKey: state.projectKey,
      queueReplay: true,
      sessionId: canResume ? resolvedSessionId : null,
      clientSessionId: canResume
        ? resolvedSessionId
        : item.payload.clientSessionId || item.payload.options?.clientSessionId || resolvedSessionId,
      options: {
        ...(item.payload.options || {}),
        projectKey: state.projectKey,
        sessionId: canResume ? resolvedSessionId : null,
        clientSessionId: canResume
          ? resolvedSessionId
          : item.payload.options?.clientSessionId || resolvedSessionId,
        resume: Boolean(canResume),
      },
    };
    state.writer?.send?.({
      type: 'agent-turn-queue-started',
      runtimeId: state.runtimeId,
      provider: state.runtimeId,
      projectKey: state.projectKey,
      sessionId: resolvedSessionId,
      item: publicItem(item),
      remaining: state.items.map(publicItem),
    });
    state.dispatch?.(payload);
  }

  cleanup(state) {
    if (state.running || state.items.length > 0 || state.drainScheduled) return;
    for (const alias of state.aliases) {
      const key = this.aliasKey(state.ownerKey, state.runtimeId, state.projectKey, alias);
      if (this.aliases.get(key) === state) this.aliases.delete(key);
    }
  }
}
