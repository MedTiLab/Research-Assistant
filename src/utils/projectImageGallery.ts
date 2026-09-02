export type ProjectImageFile = {
  name: string;
  relativePath: string;
  absolutePath: string | null;
  folder: string;
};

type ProjectFileTreeNode = {
  name?: string;
  path?: string;
  relativePath?: string;
  absolutePath?: string;
  type?: string;
  children?: ProjectFileTreeNode[];
};

export const PROJECT_IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);

export function isTiffImageFileName(fileName?: string | null) {
  const normalizedName = String(fileName || '').toLowerCase();
  return normalizedName.endsWith('.tif') || normalizedName.endsWith('.tiff');
}

function normalizePath(value?: string | null) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .trim();
}

function relativeToProject(value: string, projectRoot?: string) {
  const normalizedPath = normalizePath(value);
  const normalizedRoot = normalizePath(projectRoot);

  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath.replace(/^\/+/, '');
}

export function isProjectImageFileName(fileName?: string | null) {
  const normalizedName = String(fileName || '').toLowerCase();
  const extension = normalizedName.includes('.') ? normalizedName.split('.').pop() || '' : '';
  return PROJECT_IMAGE_EXTENSIONS.has(extension);
}

export function collectProjectImageFiles(
  nodes: ProjectFileTreeNode[] | null | undefined,
  projectRoot?: string,
): ProjectImageFile[] {
  if (!Array.isArray(nodes)) {
    return [];
  }

  const images: ProjectImageFile[] = [];

  const walk = (items: ProjectFileTreeNode[]) => {
    items.forEach((item) => {
      const rawPath = item.relativePath || item.path || item.absolutePath || '';
      const relativePath = relativeToProject(rawPath, projectRoot);
      const name = item.name || relativePath.split('/').pop() || relativePath;

      if (item.type === 'file' && relativePath && isProjectImageFileName(name)) {
        const folderParts = relativePath.split('/');
        folderParts.pop();
        images.push({
          name,
          relativePath,
          absolutePath: item.absolutePath || (normalizePath(item.path).startsWith('/') ? normalizePath(item.path) : null),
          folder: folderParts.join('/') || '.',
        });
      }

      if (item.type === 'directory' && Array.isArray(item.children)) {
        walk(item.children);
      }
    });
  };

  walk(nodes);
  return images.sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  ));
}
