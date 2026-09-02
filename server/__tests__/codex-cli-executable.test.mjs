import { describe, expect, it, vi } from 'vitest';
import { resolveCodexCliExecutable } from '../utils/codexCliExecutable.js';

describe('resolveCodexCliExecutable', () => {
  it('prefers the bundled executable when the login-shell PATH has no Codex', async () => {
    const bundled = '/Applications/MedHelp.app/Contents/Resources/kernel-runtime/codex';
    const resolveAvailable = vi.fn();

    const resolved = await resolveCodexCliExecutable({
      envVarName: 'MEDHELP_TEST_CODEX_PATH_UNUSED',
      resolveBundled: vi.fn(() => bundled),
      resolveAvailable,
    });

    expect(resolved).toBe(bundled);
    expect(resolveAvailable).not.toHaveBeenCalled();
  });

  it('falls back to the PATH command on an unbundled platform', async () => {
    const resolved = await resolveCodexCliExecutable({
      envVarName: 'MEDHELP_TEST_CODEX_PATH_UNUSED',
      resolveBundled: vi.fn(() => { throw new Error('not bundled'); }),
      probe: vi.fn(async (command) => command === 'codex'),
    });

    expect(resolved).toBe('codex');
  });
});
