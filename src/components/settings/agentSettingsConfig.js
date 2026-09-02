export const AGENT_CATEGORY_LABEL_KEYS = {
  api: 'agents.categories.api',
  models: 'agents.categories.models',
  permissions: 'tabs.permissions',
};

export const AGENT_SETTINGS = [
  {
    id: 'pi',
    name: 'medhelpOS',
    categories: ['api', 'models', 'permissions'],
  },
];

export function getAgentSettings(agentId) {
  return AGENT_SETTINGS.find((agent) => agent.id === agentId) || AGENT_SETTINGS[0];
}
