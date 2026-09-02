export const INTERNAL_PROJECT_INSTRUCTION_FILENAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'CODEX.md',
  'CURSOR.md',
  'GEMINI.md',
  'ROO.md',
  'WINDSURF.md',
]);

export const INTERNAL_PROJECT_ROOT_FILENAMES = new Set([
  ...INTERNAL_PROJECT_INSTRUCTION_FILENAMES,
  'instance.json',
  'pipeline_config.json',
  'research_brief.json',
  'tasks.json',
]);

export const PROTECTED_PROJECT_ROOT_DIRECTORIES = new Set([
  '.agents',
  '.claude',
  '.codex',
  '.gemini',
  '.medhelp',
  '.medhelpsec',
  'agent-harness',
  'skills',
]);

const INTERNAL_PROJECT_INSTRUCTION_FILENAMES_LOWER = new Set(
  Array.from(INTERNAL_PROJECT_INSTRUCTION_FILENAMES, (name) => name.toLowerCase()),
);

const PROTECTED_PROJECT_ROOT_DIRECTORIES_LOWER = new Set(
  Array.from(PROTECTED_PROJECT_ROOT_DIRECTORIES, (name) => name.toLowerCase()),
);

export function normalizeProjectRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

export function isProtectedProjectPath(relativePath) {
  const normalized = normalizeProjectRelativePath(relativePath);
  if (!normalized) {
    return false;
  }

  const segments = normalized.split('/');
  const lowerSegments = segments.map((segment) => segment.toLowerCase());

  if (lowerSegments.some((segment) => INTERNAL_PROJECT_INSTRUCTION_FILENAMES_LOWER.has(segment))) {
    return true;
  }

  return PROTECTED_PROJECT_ROOT_DIRECTORIES_LOWER.has(lowerSegments[0]);
}

export function isInternalProjectPath(relativePath) {
  const normalized = normalizeProjectRelativePath(relativePath);
  if (!normalized) {
    return false;
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) {
    return true;
  }

  if (isProtectedProjectPath(normalized)) {
    return true;
  }

  return segments.length === 1 && INTERNAL_PROJECT_ROOT_FILENAMES.has(segments[0]);
}
