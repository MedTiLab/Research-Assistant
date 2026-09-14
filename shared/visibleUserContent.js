const VISIBLE_USER_CONTENT_TAG = 'medhelp_visible_user_content';
const VISIBLE_USER_CONTENT_CLOSE = `</${VISIBLE_USER_CONTENT_TAG}>`;
const VISIBLE_USER_CONTENT_OPEN_PATTERN = new RegExp(
  `<${VISIBLE_USER_CONTENT_TAG}(?:\\s[^>]*)?>`,
  'i',
);

/**
 * Mark the exact user-authored text inside an effective provider prompt.
 * Everything outside this boundary is presentation-private by default.
 */
export function wrapVisibleUserContent(value) {
  const text = typeof value === 'string' ? value : '';
  return `<${VISIBLE_USER_CONTENT_TAG} version="1">\n${text}\n${VISIBLE_USER_CONTENT_CLOSE}`;
}

/**
 * Insert the visibility boundary around the final occurrence of the original
 * user text while preserving all runtime context sent to the provider.
 */
export function markVisibleUserContent(command, visibleUserContent) {
  const prompt = typeof command === 'string' ? command : '';
  const visible = typeof visibleUserContent === 'string' ? visibleUserContent : '';
  if (extractVisibleUserContent(prompt) !== null) return prompt;
  if (!visible) return prompt;

  const visibleIndex = prompt.lastIndexOf(visible);
  if (visibleIndex < 0) return prompt;

  return `${prompt.slice(0, visibleIndex)}${wrapVisibleUserContent(visible)}${prompt.slice(visibleIndex + visible.length)}`;
}

/**
 * Return null for legacy, unmarked prompts. An empty string is a valid marked
 * value and means the message contains no visible user text.
 */
export function extractVisibleUserContent(value) {
  const range = findVisibleUserContentRange(value);
  return range ? value.slice(range.start, range.end) : null;
}

/**
 * Locate the editable user-text span without searching for the user text
 * itself, which may be as short as punctuation or repeated in a file path.
 */
export function findVisibleUserContentRange(value) {
  if (typeof value !== 'string') return null;

  // Runtime memory can quote a previous effective prompt, including complete
  // or truncated visibility tags. Those quoted tags are data, not the current
  // request's presentation boundary. Keep offsets into the original string.
  const memoryRanges = [...value.matchAll(
    /<(execution_memory|medhelp_project_memory|research_lessons|user_memory|codex_internal_context)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
  )].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  const isOutsideMemory = (index) => !memoryRanges.some((range) => index >= range.start && index < range.end);
  const opening = [...value.matchAll(new RegExp(VISIBLE_USER_CONTENT_OPEN_PATTERN, 'gi'))]
    .find((match) => isOutsideMemory(match.index));
  if (!opening || opening.index === undefined) return null;

  const closing = [...value.matchAll(new RegExp(VISIBLE_USER_CONTENT_CLOSE, 'gi'))]
    .filter((match) => isOutsideMemory(match.index)).at(-1);
  const closingIndex = closing?.index ?? -1;
  let contentStart = opening.index + opening[0].length;
  let contentEnd = closingIndex;
  if (closingIndex < contentStart) return null;

  if (value.slice(contentStart, contentStart + 2) === '\r\n') contentStart += 2;
  else if (value[contentStart] === '\n') contentStart += 1;

  if (value.slice(contentEnd - 2, contentEnd) === '\r\n') contentEnd -= 2;
  else if (value[contentEnd - 1] === '\n') contentEnd -= 1;

  return { start: contentStart, end: contentEnd };
}
