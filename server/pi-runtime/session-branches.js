// Independent Pi JSONL tree traversal. No user transcript is rewritten or deleted.
const isEntry = (entry) => entry?.type !== 'session' && typeof entry?.id === 'string';
export function activePiBranchRecords(records) {
  const entries = records.filter(isEntry);
  // Older single-line/faux records have no tree ids. Preserve their existing linear behavior.
  if (!entries.length || records.some((entry) => entry.type === 'message' && !entry.id)) return records;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const active = [], visited = new Set();
  let entry = entries.at(-1);
  while (entry) {
    if (visited.has(entry.id)) throw new Error('Pi session has a cyclic parent chain');
    visited.add(entry.id); active.push(entry);
    if (entry.parentId && !byId.has(entry.parentId)) throw new Error('Pi session has a missing branch parent');
    entry = byId.get(entry.parentId);
  }
  return [...records.filter((entry) => ['session', 'session_start'].includes(entry.type)), ...active.reverse()];
}

export function piSessionBranches(records, sessionId) {
  const branches = new Map([['main', { id: 'main', parentId: null, label: '主分支', fromEntryId: null, leafId: null }]]);
  const branchByEntry = new Map();
  let activeBranchId = 'main';
  for (const entry of records.filter(isEntry)) {
    let branchId = branchByEntry.get(entry.parentId) || 'main';
    if (entry.type === 'custom' && entry.customType === 'medhelp.branch') {
      branchId = entry.data.branchId;
      if (!branches.has(branchId)) branches.set(branchId, { id: branchId, parentId: entry.data.parentBranchId || 'main', label: entry.data.label || '会话分支', fromEntryId: entry.data.fromEntryId, leafId: entry.id });
    }
    branchByEntry.set(entry.id, branchId);
    branches.get(branchId).leafId = entry.id;
    activeBranchId = branchId;
  }
  const messages = activePiBranchRecords(records).filter((entry) => entry.type === 'message' && entry.id && ['user', 'assistant'].includes(entry.message?.role)).flatMap((entry) => {
    const content = entry.message.content;
    if (Array.isArray(content) && content.some((part) => part.type === 'toolCall' || part.type === 'tool_use')) return [];
    const text = typeof content === 'string' ? content : (content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    return text ? [{ id: entry.id, parentId: entry.parentId, role: entry.message.role, preview: text.slice(0, 180) }] : [];
  });
  return { sessionId, activeBranchId, branches: [...branches.values()], messages, filesReverted: false };
}

// Files/artifacts stay shared. Conversation todos/plans and task cards follow the selected path.
export function piBranchAgentState(records, state) {
  if (!records.some((entry) => entry.customType === 'medhelp.branch')) return state;
  const active = activePiBranchRecords(records);
  const calls = new Map();
  let todos = [], plan = null;
  for (const entry of active) {
    const message = entry.message;
    if (message?.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === 'toolCall') calls.set(part.id, part.name === 'tool_call' ? { name: part.arguments?.name, arguments: part.arguments?.arguments } : part);
    }
    if (message?.role !== 'toolResult' || message.isError) continue;
    const call = calls.get(message.toolCallId);
    let result;
    try { result = JSON.parse((message.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')); } catch { result = null; }
    if (call?.name === 'todo_write') todos = Array.isArray(result?.todos) ? result.todos : Array.isArray(result) ? result : call.arguments?.todos || [];
    if (call?.name === 'plan_update') plan = result?.plan ? result : { ...call.arguments, status: 'draft' };
    if (call?.name === 'exit_plan_mode' && plan) plan = { ...plan, status: result?.approved ? 'approved' : 'rejected' };
  }
  return { ...state, todos, plan, tasks: (state.tasks || []).filter((task) => calls.has(task.toolCallId)) };
}
