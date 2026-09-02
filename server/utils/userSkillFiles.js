import matter from 'gray-matter';
import path from 'path';

export function customizeUserSkillDocument(rawSkill, { name, description = '' }) {
  const parsed = matter(String(rawSkill || ''));
  const normalizedDescription = String(description || '').trim();
  return matter.stringify(parsed.content, {
    ...parsed.data,
    name,
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
  });
}

export function resolveUserSkillExtractionPath(rootDir, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const resolved = path.resolve(rootDir, ...normalized.split('/'));
  if (resolved === rootDir || resolved.startsWith(`${rootDir}${path.sep}`)) return resolved;
  return null;
}
