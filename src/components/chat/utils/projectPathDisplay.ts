import type { Project } from '../../../types/app';
import { normalizeChatFilePath } from './filePathLinks';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(value?: string | null): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function getProjectRootPath(project?: Pick<Project, 'fullPath' | 'path'> | null): string {
  return normalizePath(project?.fullPath || project?.path || '');
}

export function formatProjectRelativePaths(value: unknown, projectRoot?: string | null): string {
  const text = String(value ?? '');
  const normalizedRoot = normalizePath(projectRoot);
  if (!text || !normalizedRoot) {
    return text;
  }

  const rootVariants = unique([
    normalizedRoot,
    encodeURI(normalizedRoot),
  ]);

  let result = text;
  for (const rootVariant of rootVariants) {
    const rootPattern = escapeRegExp(rootVariant);
    result = result
      .replace(new RegExp(`file://${rootPattern}/`, 'g'), '')
      .replace(new RegExp(`${rootPattern}/`, 'g'), '')
      .replace(new RegExp(`file://${rootPattern}(?=$|[\\s"'\\)\\]\\}>,])`, 'g'), '.')
      .replace(new RegExp(`${rootPattern}(?=$|[\\s"'\\)\\]\\}>,])`, 'g'), '.');
  }

  return result;
}

export function toProjectRelativeDisplayPath(value?: string | null, projectRoot?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const normalizedRoot = normalizePath(projectRoot);
  const normalizedPath = normalizeChatFilePath(raw).replace(/\\/g, '/').trim();
  if (!normalizedRoot || !normalizedPath) {
    return raw.replace(/\\/g, '/');
  }

  if (normalizedPath === normalizedRoot) {
    return '.';
  }

  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return formatProjectRelativePaths(raw, normalizedRoot).replace(/\\/g, '/');
}
