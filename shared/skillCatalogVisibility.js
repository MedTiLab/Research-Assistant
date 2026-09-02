/**
 * Classify a request for a file under the read-only skills catalog root.
 * - 'config'         -> root-level catalog/config JSON (metadata, safe to serve).
 * - 'skill-metadata' -> a skill's SKILL.md (return name/description only, never the body).
 * - 'blocked'        -> any other file inside a skill (references/scripts/prompts/body).
 *
 * @param {string} relPath skills-root-relative path (already traversal-checked by the caller)
 * @returns {'config'|'skill-metadata'|'blocked'}
 */
export function classifySkillCatalogFileRequest(relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return 'blocked';
  }

  const basename = segments[segments.length - 1];

  if (segments.length === 1 && basename.toLowerCase().endsWith('.json')) {
    return 'config';
  }

  if (basename === 'SKILL.md') {
    return 'skill-metadata';
  }

  return 'blocked';
}
