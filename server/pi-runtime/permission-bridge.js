import crypto from 'crypto';
import { createAgentSessionIdentity } from '../utils/agentSessionIdentity.js';

export const PI_TOOL_APPROVAL_TIMEOUT_MS = 120_000;

function normalizeDecision(decision = {}) {
  return Object.freeze({
    allow: decision.allow === true,
    cancelled: decision.cancelled === true,
    reason: typeof decision.reason === 'string' ? decision.reason : null,
    message: typeof decision.message === 'string' ? decision.message : null,
    updatedInput: decision.updatedInput && typeof decision.updatedInput === 'object'
      ? decision.updatedInput
      : null,
    rememberEntry: typeof decision.rememberEntry === 'string' ? decision.rememberEntry : null,
  });
}

export class PiPermissionBridge {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? PI_TOOL_APPROVAL_TIMEOUT_MS;
    this.createRequestId = options.createRequestId || (() => `pi-permission-${crypto.randomUUID()}`);
    this.pending = new Map();
  }

  request(options = {}) {
    const identity = createAgentSessionIdentity(options.identity);
    const sessionKey = typeof options.sessionKey === 'string' ? options.sessionKey.trim() : '';
    if (!sessionKey) throw new Error('Pi permission requests require a session key.');
    const requestId = this.createRequestId();
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : this.timeoutMs;
    if (!options.writer || typeof options.writer.send !== 'function') {
      return Promise.resolve(normalizeDecision({
        allow: false,
        cancelled: true,
        reason: 'approval_channel_unavailable',
      }));
    }
    if (options.signal?.aborted) {
      return Promise.resolve(normalizeDecision({
        allow: false,
        cancelled: true,
        reason: 'aborted',
      }));
    }

    return new Promise((resolve) => {
      let abortListener = null;
      const settle = (decision, cancelReason = null) => {
        const pending = this.pending.get(requestId);
        if (!pending) return false;
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        if (abortListener) options.signal?.removeEventListener?.('abort', abortListener);
        if (cancelReason) {
          options.writer?.send?.({
            type: 'agent-permission-cancelled',
            runtimeId: 'pi',
            provider: 'pi',
            requestId,
            reason: cancelReason,
            sessionId: identity.sessionId,
            projectKey: identity.projectKey,
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
          });
        }
        resolve(normalizeDecision(decision));
        return true;
      };
      const timer = setTimeout(() => {
        settle({ allow: false, cancelled: true, reason: 'timeout' }, 'timeout');
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, {
        requestId,
        sessionKey,
        approvalId: options.approvalId || null,
        identity,
        toolCallId: options.toolCallId || null,
        toolName: options.toolName || 'unknown',
        timer,
        settle,
      });
      abortListener = () => {
        settle({ allow: false, cancelled: true, reason: 'aborted' }, 'aborted');
      };
      options.signal?.addEventListener?.('abort', abortListener, { once: true });
      options.writer?.send?.({
        type: 'agent-permission-request',
        runtimeId: 'pi',
        provider: 'pi',
        requestId,
        toolCallId: options.toolCallId || null,
        toolName: options.toolName || 'unknown',
        input: options.input && typeof options.input === 'object' ? options.input : {},
        sessionId: identity.sessionId,
      });
    });
  }

  resolve(requestId, decision = {}, context = {}) {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    const ownerKey = typeof context.ownerKey === 'string' ? context.ownerKey : null;
    if (ownerKey && pending.identity.ownerKey !== ownerKey) return false;
    return pending.settle(decision);
  }

  resolveHostApproval(sessionKey, approvalId, decision = {}) {
    if (!approvalId) return false;
    for (const pending of this.pending.values()) {
      if (pending.sessionKey !== sessionKey || pending.approvalId !== approvalId) continue;
      // The Host can expire first. Remove the matching request immediately,
      // including its independent timer and the renderer's question card.
      return pending.settle(decision, decision.reason || 'host_resolved');
    }
    return false;
  }

  cancelSession(sessionKey, reason = 'cancelled') {
    let cancelled = 0;
    for (const pending of [...this.pending.values()]) {
      if (pending.sessionKey !== sessionKey) continue;
      if (pending.settle(
        { allow: false, cancelled: true, reason },
        reason,
      )) cancelled += 1;
    }
    return cancelled;
  }

  size() {
    return this.pending.size;
  }
}

export function createPiPermissionBridge(options = {}) {
  return new PiPermissionBridge(options);
}
