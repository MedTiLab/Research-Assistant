export const PI_SUBAGENT_PROFILES = Object.freeze({
  'general-purpose': { tools: ['read', 'grep', 'find', 'ls', 'system_info', 'memory_retrieve', 'web_fetch', 'web_search'], prompt: 'Review the task using read-only project inspection and public sources. Return evidence and limitations.' },
  explore: { tools: ['read', 'grep', 'find', 'ls', 'system_info'], prompt: 'Explore local project files only. Cite paths and explain findings. No network tools are available.' },
  research: { tools: ['read', 'memory_retrieve', 'web_fetch', 'web_search'], prompt: 'Research using public sources and supplied documents. Cite source URLs or paths and distinguish evidence from inference.' },
});
export function piSubagentProfile(type = 'general-purpose') {
  const profile = PI_SUBAGENT_PROFILES[type];
  if (!profile) throw new Error(`Unsupported subagent_type: ${type}. Use general-purpose, explore or research.`);
  return profile;
}
