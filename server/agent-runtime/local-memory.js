import { readProjectMemoryFile, captureProjectMemoryFacts } from '../project-memory/automatic-project-memory.js';
import { resolvePiToolPath } from '../pi-runtime/tool-policy.js';
import { selectRelevantUserMemories } from '../user-memory/automatic-user-memory.js';

export function createLocalMemoryAdapter({
  getDb = async () => (await import('../database/db.js')).userLongTermMemoryDb,
  authorize = async (userId, capability) => (await import('../utils/entitlements.js')).authorize(userId, capability).allowed,
} = {}) {
  return {
    async execute(name, input, context) {
      const userId = context.userId;
      const memoryContext = context.memoryContext;
      if (!userId && !memoryContext) throw new Error('Existing user memory is unavailable; reconnect your account');
      const db = memoryContext ? null : await getDb();
      const settings = memoryContext || db.getSettings(userId);
      const allowed = (scope) => context.authorizeMemory ? context.authorizeMemory(scope) : authorize(userId, scope === 'project' ? 'memory.project_summary' : 'memory.persistent');
      const [userAllowed, projectAllowed] = await Promise.all([allowed('user'), allowed('project')]);
      if (!userAllowed && !projectAllowed) throw new Error('Memory access is not enabled for this account');
      // The existing project memory writer owns its queue and storage. Validate symlinks before entering it.
      await resolvePiToolPath(context.projectRoot, '.medhelpsec/MEMORY.md');
      if (name === 'memory_retrieve') {
        if (settings.enabled === false) return { enabled: false, message: 'Memory recall is disabled in Settings.' };
        const query = String(input.query || '').trim().toLowerCase();
        const sourceMemories = memoryContext
          ? (memoryContext.memories || [])
          : db.getAll(userId, { limit: 300 });
        const memories = selectRelevantUserMemories(userAllowed ? sourceMemories : [], query, { maxItems: 30 })
          .map(({ id, content, source, pinned }) => ({ id, content, scope: 'user', source, pinned }));
        const file = projectAllowed ? await readProjectMemoryFile(context.projectRoot) : { content: '', relativePath: '.medhelpsec/MEMORY.md' };
        const lines = file.content.split('\n').filter((line) => !query || line.toLowerCase().includes(query));
        return { enabled: true, memories, projectMemory: lines.join('\n').slice(-16_000), source: file.relativePath, untrustedHistoricalContext: true };
      }
      const content = String(input.content || '').trim();
      if (!content || content.length > 240) throw new Error('Remember one concise fact (1–240 characters)');
      if (input.scope === 'project') {
        if (!projectAllowed) throw new Error('Project memory access is not enabled');
        return { source: '.medhelpsec/MEMORY.md', ...await captureProjectMemoryFacts(context.projectRoot, [content]) };
      }
      if (input.scope !== 'user') throw new Error('Memory scope must be project or user');
      if (!userAllowed) throw new Error('User memory access is not enabled');
      if (memoryContext) {
        if (!context.saveUserMemory) throw new Error('Reconnect your account to save user memory');
        const memory = await context.saveUserMemory(content);
        memoryContext.memories = [memory, ...(memoryContext.memories || []).filter((item) => item.id !== memory.id)].slice(0, 300);
        return { source: 'user_long_term_memories', memory };
      }
      return { source: 'user_long_term_memories', memory: db.create(userId, content, { source: 'manual' }).memory };
    },
  };
}
