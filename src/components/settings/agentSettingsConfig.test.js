import { describe, expect, it } from 'vitest';

import {
  AGENT_CATEGORY_LABEL_KEYS,
  AGENT_SETTINGS,
  getAgentSettings,
} from './agentSettingsConfig';

describe('agent settings registry', () => {
  it('keeps MCP plugins outside the medhelpOS agent settings categories', () => {
    expect(AGENT_SETTINGS.map((agent) => agent.id)).toEqual(['pi']);
    expect(AGENT_SETTINGS[0].name).toBe('medhelpOS');
    expect(getAgentSettings('pi').categories).toEqual(['api', 'models', 'permissions']);
    expect(getAgentSettings('claude')).toBe(getAgentSettings('pi'));
    expect(getAgentSettings('codex')).toBe(getAgentSettings('pi'));
    expect(AGENT_CATEGORY_LABEL_KEYS).toMatchObject({
      api: 'agents.categories.api',
      models: 'agents.categories.models',
      permissions: 'tabs.permissions',
    });
  });
});
