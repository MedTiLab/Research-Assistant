import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveUserClaudePluginDir } from '../utils/storagePaths.js';

describe('resolveUserClaudePluginDir', () => {
  it('is a backend-private per-user path under the app data root', () => {
    const dir = resolveUserClaudePluginDir(42, { dataDir: '/tmp/medhelp-data' });
    expect(dir).toBe(path.join('/tmp/medhelp-data', 'users', '42', 'agent-plugins', 'claude'));
  });

  it('sanitizes ids and falls back to anonymous', () => {
    expect(resolveUserClaudePluginDir(null, { dataDir: '/tmp/d' }))
      .toBe(path.join('/tmp/d', 'users', 'anonymous', 'agent-plugins', 'claude'));
    expect(resolveUserClaudePluginDir('a/../b', { dataDir: '/tmp/d' }))
      .toBe(path.join('/tmp/d', 'users', 'a-..-b', 'agent-plugins', 'claude'));
  });
});
