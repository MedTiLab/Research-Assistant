export const LONG_TERM_MEMORY_MAX_CHARS = 240;

const SENSITIVE_PATTERNS = [
  { code: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { code: 'access_token', pattern: /\b(?:sk-(?:proj-)?|rk-|gh[opusr]_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{12,}\b/ },
  { code: 'access_token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { code: 'credential', pattern: /(?:password|passwd|api[_ -]?key|access[_ -]?token|client[_ -]?secret|密码|口令|密钥|验证码)\s*(?:is|是|为|[:=])\s*\S{4,}/i },
  { code: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { code: 'phone', pattern: /(?:^|\D)(?:\+?86[- ]?)?1[3-9]\d{9}(?:\D|$)/ },
  { code: 'government_id', pattern: /(?:^|\D)\d{17}[\dXx](?:\D|$)/ },
  { code: 'government_id', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { code: 'health_identifier', pattern: /(?:MRN|medical record number|patient id|病历号|住院号|患者编号)\s*(?:是|为|[:#：])?\s*[A-Z0-9-]{4,}/i },
];

export function normalizeLongTermMemoryContent(content) {
  return String(content || '')
    .replace(/<\/?user_memory>/gi, ' ')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LONG_TERM_MEMORY_MAX_CHARS);
}

export function inspectLongTermMemoryContent(content) {
  const normalized = normalizeLongTermMemoryContent(content);
  if (!normalized) return { safe: false, code: 'empty', content: '' };
  const match = SENSITIVE_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  if (match) return { safe: false, code: match.code, content: normalized };
  return { safe: true, code: null, content: normalized };
}

export function isSafeLongTermMemoryContent(content) {
  return inspectLongTermMemoryContent(content).safe;
}

export function assertSafeLongTermMemoryContent(content) {
  const inspection = inspectLongTermMemoryContent(content);
  if (inspection.safe) return inspection.content;
  const error = new Error(inspection.code === 'empty'
    ? 'Memory content is required'
    : 'This memory may contain a secret or personal identifier and was not saved');
  error.code = inspection.code === 'empty' ? 'MEMORY_CONTENT_REQUIRED' : 'MEMORY_SENSITIVE_CONTENT';
  throw error;
}
