import { describe, expect, it } from 'vitest';
import { shouldImportLoginShellEnvironment } from '../utils/loginShellEnvironment.js';

describe('login shell import policy', () => {
  it.each(['dev', 'client', 'server', 'server:watch', 'test'])('reuses the environment for npm %s', (event) => {
    expect(shouldImportLoginShellEnvironment({ npm_lifecycle_event: event }, 'darwin')).toBe(false);
  });

  it('retains shell import for direct launches and explicit opt-in', () => {
    expect(shouldImportLoginShellEnvironment({}, 'darwin')).toBe(true);
    expect(shouldImportLoginShellEnvironment({ npm_lifecycle_event: 'dev', MEDHELP_ENABLE_LOGIN_SHELL_ENV_IMPORT: '1' }, 'darwin')).toBe(true);
    expect(shouldImportLoginShellEnvironment({ npm_lifecycle_event: 'dev', MEDHELP_LOGIN_SHELL: '/bin/zsh' }, 'darwin')).toBe(true);
  });

  it('honors disable, prevents recursive imports, and skips Windows', () => {
    for (const key of ['MEDHELP_DISABLE_LOGIN_SHELL_ENV_IMPORT', 'MEDHELP_LOGIN_SHELL_ENV_IMPORT']) {
      expect(shouldImportLoginShellEnvironment({ [key]: '1', MEDHELP_ENABLE_LOGIN_SHELL_ENV_IMPORT: '1' }, 'darwin')).toBe(false);
    }
    expect(shouldImportLoginShellEnvironment({}, 'win32')).toBe(false);
  });
});
