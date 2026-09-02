export type SkillNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillNode[];
};

const NON_SKILL_DIRECTORY_NAMES = new Set([
  '__pycache__',
  'asset',
  'assets',
  'scripts',
  'script',
  'references',
  'reference',
  'prompts',
  'prompt',
  'resources',
  'resource',
  'examples',
  'example',
  'templates',
  'template',
  'tests',
  'test',
]);

export function countSkillNodeFiles(node: SkillNode): number {
  if (node.type === 'file') {
    return 1;
  }

  return (node.children ?? []).reduce((acc, child) => acc + countSkillNodeFiles(child), 0);
}

export function findDirectFilePathByName(node: SkillNode, fileName: string): string | null {
  if (node.type !== 'directory') {
    return null;
  }

  const directFile = (node.children ?? []).find(
    (child) => child.type === 'file' && child.name === fileName
  );

  return directFile?.path ?? null;
}

function isLikelyNonSkillDirectory(node: SkillNode): boolean {
  return NON_SKILL_DIRECTORY_NAMES.has(node.name.toLowerCase());
}

export function collectSkillDirectories(nodes: SkillNode[]): SkillNode[] {
  const results: SkillNode[] = [];
  const seenPaths = new Set<string>();

  const push = (node: SkillNode) => {
    if (node.type !== 'directory') return;
    if (isLikelyNonSkillDirectory(node)) return;
    if (seenPaths.has(node.path)) return;
    seenPaths.add(node.path);
    results.push(node);
  };

  const visit = (node: SkillNode, depthFromRoot: number): boolean => {
    if (node.type !== 'directory') {
      return false;
    }

    if (findDirectFilePathByName(node, 'SKILL.md')) {
      push(node);
      return true;
    }

    const childDirs = (node.children ?? []).filter((child) => child.type === 'directory');
    let foundDescendantSkill = false;

    for (const childDir of childDirs) {
      if (visit(childDir, depthFromRoot + 1)) {
        foundDescendantSkill = true;
      }
    }

    if (!foundDescendantSkill && depthFromRoot === 0 && childDirs.length === 0 && countSkillNodeFiles(node) > 0) {
      push(node);
      return true;
    }

    return foundDescendantSkill;
  };

  for (const node of nodes) {
    if (node.type === 'directory') {
      visit(node, 0);
    }
  }

  return results;
}
