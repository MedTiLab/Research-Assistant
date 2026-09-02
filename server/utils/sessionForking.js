function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && (part.type === 'text' || typeof part.text === 'string'))
    .map((part) => String(part.text || ''))
    .join('\n');
}

function previewText(value, maximum = 90) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

export function conversationForkPoints(messages = [], options = {}) {
  const points = [];
  let pendingUser = '';
  let pendingAssistantId = '';
  const flushTurn = () => {
    if (pendingUser && pendingAssistantId) {
      points.push({ id: pendingAssistantId, turn: points.length + 1, preview: pendingUser });
    }
    pendingUser = '';
    pendingAssistantId = '';
  };
  for (const entry of Array.isArray(messages) ? messages : []) {
    const role = options.role?.(entry) || entry?.role || entry?.message?.role;
    if (role === 'user') {
      const rawText = options.text?.(entry) ?? entry?.content ?? entry?.message?.content;
      const text = typeof rawText === 'string' ? rawText : contentText(rawText);
      const preview = previewText(text);
      if (!preview) continue;
      flushTurn();
      pendingUser = preview;
      continue;
    }
    if (role !== 'assistant' || !pendingUser) continue;
    const id = options.id?.(entry) || entry?.id || entry?.uuid;
    if (typeof id !== 'string' || !id) continue;
    pendingAssistantId = id;
  }
  flushTurn();
  return points;
}

export function codexForkPoints(thread) {
  const points = [];
  for (const turn of Array.isArray(thread?.turns) ? thread.turns : []) {
    if (turn?.status === 'inProgress' || turn?.status === 'in_progress') continue;
    const userItem = Array.isArray(turn?.items)
      ? turn.items.find((item) => item?.type === 'userMessage')
      : null;
    const preview = previewText(contentText(userItem?.content));
    if (typeof turn?.id !== 'string' || !preview) continue;
    points.push({ id: turn.id, turn: points.length + 1, preview });
  }
  return points;
}

export function forkedSessionTitle(session) {
  const source = String(
    session?.summary || session?.name || session?.title || session?.displayName || session?.display_name || '新对话',
  ).trim();
  return `${source.slice(0, 80)}（分叉）`;
}
