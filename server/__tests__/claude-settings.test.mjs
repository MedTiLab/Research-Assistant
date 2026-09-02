import path from 'path';
import { describe, expect, it, vi } from 'vitest';

import {
  getClaudeSettingsPath,
  readClaudeCustomApiConfig,
} from '../utils/claudeSettings.js';

describe('Claude settings custom API detection', () => {
  it('recognizes a Windows user settings.json without exposing its token', async () => {
    const homeDir = 'C:\\Users\\researcher';
    const readFile = vi.fn(async () => JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'secret-token',
        ANTHROPIC_BASE_URL: 'https://claude-proxy.example/v1',
      },
    }));

    const result = await readClaudeCustomApiConfig({ env: {}, homeDir, readFile });

    expect(readFile).toHaveBeenCalledWith(
      path.join(homeDir, '.claude', 'settings.json'),
      'utf8',
    );
    expect(result).toEqual({
      configured: true,
      source: 'settings.json',
      baseUrl: 'https://claude-proxy.example/v1',
      configPath: getClaudeSettingsPath(homeDir),
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('prefers an inherited custom API environment over the settings file', async () => {
    const readFile = vi.fn();

    await expect(readClaudeCustomApiConfig({
      env: {
        ANTHROPIC_API_KEY: 'environment-secret',
        ANTHROPIC_BASE_URL: 'https://env-proxy.example',
      },
      homeDir: 'C:\\Users\\researcher',
      readFile,
    })).resolves.toEqual({
      configured: true,
      source: 'environment',
      baseUrl: 'https://env-proxy.example',
      configPath: null,
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('treats a missing or malformed settings file as unconfigured', async () => {
    await expect(readClaudeCustomApiConfig({
      env: {},
      homeDir: 'C:\\Users\\researcher',
      readFile: vi.fn(async () => '{invalid'),
    })).resolves.toMatchObject({ configured: false, source: null, baseUrl: null });
  });
});
