import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumeProjectFileChatContext,
  createChatDraftOpenRequest,
  PROJECT_FILE_CHAT_CONTEXT_EVENT,
  queueProjectFileChatContext,
} from './projectFileChatContext';

const createSessionStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe('projectFileChatContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifies the mounted chat when adding a file to the current conversation', () => {
    const dispatchEvent = vi.fn((_event: Event) => true);
    vi.stubGlobal('window', {
      sessionStorage: createSessionStorage(),
      dispatchEvent,
    });

    queueProjectFileChatContext('demo', { name: 'notes.md', path: '/demo/notes.md' });

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0].type).toBe(PROJECT_FILE_CHAT_CONTEXT_EVENT);
    expect(consumeProjectFileChatContext('demo')).toEqual([
      { name: 'notes.md', path: '/demo/notes.md', absolutePath: null, kind: 'file' },
    ]);
  });

  it('carries files in an explicit new-chat request and advances its identity', () => {
    const request = createChatDraftOpenRequest(
      { requestKey: 7, projectName: 'old-project', projectFiles: [] },
      'SeerFound',
      [{ name: 'result.md', path: '/SeerFound/Experiment/result.md' }],
    );

    expect(request).toEqual({
      requestKey: 8,
      projectName: 'SeerFound',
      projectFiles: [{
        name: 'result.md',
        path: '/SeerFound/Experiment/result.md',
        absolutePath: null,
        kind: 'file',
      }],
    });
  });
});
