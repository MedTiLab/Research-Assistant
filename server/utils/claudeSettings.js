import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function getClaudeSettingsPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.claude', 'settings.json');
}

export async function readClaudeCustomApiConfig({
  env = process.env,
  homeDir = os.homedir(),
  readFile = fs.readFile,
} = {}) {
  const environmentToken = firstNonEmptyString(
    env?.ANTHROPIC_AUTH_TOKEN,
    env?.ANTHROPIC_API_KEY,
  );
  if (environmentToken) {
    return {
      configured: true,
      source: 'environment',
      baseUrl: firstNonEmptyString(env?.ANTHROPIC_BASE_URL, env?.ANTHROPIC_API_URL) || null,
      configPath: null,
    };
  }

  const configPath = getClaudeSettingsPath(homeDir);
  try {
    const settings = JSON.parse(await readFile(configPath, 'utf8'));
    const settingsEnv = settings?.env && typeof settings.env === 'object'
      ? settings.env
      : {};
    const settingsToken = firstNonEmptyString(
      settingsEnv.ANTHROPIC_AUTH_TOKEN,
      settingsEnv.ANTHROPIC_API_KEY,
    );
    return {
      configured: Boolean(settingsToken),
      source: settingsToken ? 'settings.json' : null,
      baseUrl: firstNonEmptyString(
        settingsEnv.ANTHROPIC_BASE_URL,
        settingsEnv.ANTHROPIC_API_URL,
      ) || null,
      configPath,
    };
  } catch {
    return {
      configured: false,
      source: null,
      baseUrl: null,
      configPath,
    };
  }
}
