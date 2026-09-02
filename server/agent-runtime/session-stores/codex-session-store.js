import { RuntimeSessionStore } from './runtime-session-store.js';

export class CodexSessionStore extends RuntimeSessionStore {
  constructor(operations = {}) {
    super('codex', operations);
  }
}
