import { describe, expect, it, vi } from 'vitest';
import { resolveClaudeCodeExecutableInfo } from '../utils/claudeCodeExecutable.js';
import { getCliAuthStatus, resolveClaudeStatusExecutable } from '../routes/cli-auth.js';

describe('Claude bundled runtime resolution', () => {
  it('uses the Agent SDK native runtime without a login-shell PATH', () => {
    const result = resolveClaudeCodeExecutableInfo({
      env: {
        ...process.env,
        CLAUDE_CLI_PATH: '',
        PATH: '',
      },
      preferBundledNative: true,
    });

    expect(result.source).toBe('bundled-native');
    expect(result.executable).toMatch(/claude-agent-sdk-.+[\\/]claude(?:\.exe)?$/);
  });

  it('does not let a local CLI override shadow Desktop bundled status', () => {
    const resolve = vi.fn(() => ({ executable: '/bundled/claude', source: 'bundled-native' }));

    expect(resolveClaudeStatusExecutable({
      env: { HOME: '/Users/test', CLAUDE_CLI_PATH: '/stale/local/claude' },
      resolve,
    })).toEqual({ executable: '/bundled/claude', source: 'bundled-native' });
    expect(resolve).toHaveBeenCalledWith({
      env: { HOME: '/Users/test', CLAUDE_CLI_PATH: '' },
      preferBundledNative: true,
    });
  });

  it('does not expose Claude authentication through the Pi-only CLI status API', async () => {
    const previousToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_AUTH_TOKEN = 'windows-custom-token';
    process.env.ANTHROPIC_BASE_URL = 'https://claude-proxy.example/v1';

    try {
      const status = await getCliAuthStatus('claude');
      expect(status).toMatchObject({
        authenticated: false,
        cliAvailable: false,
        error: 'Unsupported CLI provider: claude',
      });
      expect(JSON.stringify(status)).not.toContain('windows-custom-token');
    } finally {
      if (previousToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previousToken;
      if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
    }
  });
});
