import { createAgentSessionIdentity } from '../../utils/agentSessionIdentity.js';

const NOOP_ASYNC = async () => null;

export class RuntimeSessionStore {
  constructor(runtimeId, operations = {}) {
    this.runtimeId = runtimeId;
    this.operations = Object.freeze({ ...operations });
  }

  normalizeIdentity(identity) {
    const normalized = createAgentSessionIdentity(identity);
    if (normalized.runtimeId !== this.runtimeId) {
      const error = new Error(
        `Session identity runtime "${normalized.runtimeId}" cannot be handled by "${this.runtimeId}" store.`,
      );
      error.code = 'RUNTIME_SESSION_STORE_IDENTITY_MISMATCH';
      error.runtimeId = normalized.runtimeId;
      throw error;
    }
    return normalized;
  }

  list(projectIdentity, options = {}) {
    return (this.operations.list || NOOP_ASYNC)(projectIdentity, options);
  }

  read(identity, options = {}) {
    return (this.operations.read || NOOP_ASYNC)(this.normalizeIdentity(identity), options);
  }

  forkPoints(identity, options = {}) {
    return (this.operations.forkPoints || NOOP_ASYNC)(this.normalizeIdentity(identity), options);
  }

  fork(identity, input, options = {}) {
    return (this.operations.fork || NOOP_ASYNC)(this.normalizeIdentity(identity), input, options);
  }

  rename(identity, title, options = {}) {
    return (this.operations.rename || NOOP_ASYNC)(this.normalizeIdentity(identity), title, options);
  }

  trash(identity, options = {}) {
    return (this.operations.trash || NOOP_ASYNC)(this.normalizeIdentity(identity), options);
  }

  restore(identity, options = {}) {
    return (this.operations.restore || NOOP_ASYNC)(this.normalizeIdentity(identity), options);
  }

  delete(identity, options = {}) {
    return (this.operations.delete || NOOP_ASYNC)(this.normalizeIdentity(identity), options);
  }

  getUsage(identity, options = {}) {
    return (this.operations.getUsage || NOOP_ASYNC)(this.normalizeIdentity(identity), options);
  }

  reconcile(identity, options = {}) {
    return (this.operations.reconcile || NOOP_ASYNC)(this.normalizeIdentity(identity), options);
  }

  watchRoots(options = {}) {
    return this.operations.watchRoots?.(options) || [];
  }
}
