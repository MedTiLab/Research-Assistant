import { RuntimeSessionStore } from './runtime-session-store.js';

// The concrete Pi file/RPC operations are injected by the Pi Host phase. Keeping
// the adapter contract available now prevents projects/routes from adding a new
// Pi-specific persistence branch later.
export class PiSessionStore extends RuntimeSessionStore {
  constructor(operations = {}) {
    super('pi', operations);
  }
}
