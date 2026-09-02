import { RuntimeSessionStore } from './runtime-session-store.js';

export class ClaudeSessionStore extends RuntimeSessionStore {
  constructor(operations = {}) {
    super('claude', operations);
  }
}
