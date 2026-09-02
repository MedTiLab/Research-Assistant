export type ResearchPipelineStageKey =
  | 'literature'
  | 'ideation'
  | 'experiment'
  | 'publication'
  | 'promotion';

export type ResearchStageArtifactCounts = Record<ResearchPipelineStageKey, number>;

export type ResearchArtifactPipelineStage = ResearchPipelineStageKey | 'unassigned';

export type ProjectFileTreeNode = {
  name?: string;
  path?: string;
  relativePath?: string;
  absolutePath?: string;
  type?: string;
  children?: ProjectFileTreeNode[];
};

export type ResearchArtifactFile = {
  name: string;
  relativePath: string;
  path?: string;
  absolutePath?: string;
};

export const RESEARCH_PIPELINE_STAGE_KEYS: ResearchPipelineStageKey[] = [
  'literature',
  'ideation',
  'experiment',
  'publication',
  'promotion',
];

export const DEFAULT_RESEARCH_ARTIFACT_HIDDEN_NAMES = [
  'research_brief.json',
  'tasks.json',
] as const;

const LITERATURE_ROOT_PATTERN = /^(Literature|literature|Survey|Research)\//;
const VISIBLE_WORK_STAGE_ROOT_PATTERN = /^(Ideation|Experiment)\//;
const PIPELINE_LOG_PATTERN = /^(Literature|literature|Survey|Ideation|Experiment)\/.*\/logs\//;

function normalizeProjectRoot(projectRoot?: string) {
  if (!projectRoot) return '';
  return `${projectRoot.replace(/[/\\]+$/, '')}/`.replace(/\\/g, '/');
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

export function toResearchArtifactRelativePath(
  filePath?: string | null,
  projectRoot?: string,
) {
  if (!filePath || typeof filePath !== 'string') return '';

  const normalizedPath = filePath.replace(/\\/g, '/').trim();
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  const relativePath = normalizedRoot && normalizedPath.startsWith(normalizedRoot)
    ? normalizedPath.slice(normalizedRoot.length)
    : normalizedPath;

  return relativePath.replace(/^\/+/, '');
}

export function createEmptyResearchStageArtifactCounts(): ResearchStageArtifactCounts {
  return {
    literature: 0,
    ideation: 0,
    experiment: 0,
    publication: 0,
    promotion: 0,
  };
}

export function shouldCollectResearchArtifact(relativePath: string) {
  const rel = toResearchArtifactRelativePath(relativePath);
  if (!rel) return false;

  const pathSegments = rel.split('/').filter(Boolean);
  const fileName = pathSegments[pathSegments.length - 1]?.toLowerCase() || '';
  if (
    pathSegments.some((segment) => segment.startsWith('.'))
    || fileName === 'thumbs.db'
    || fileName === 'desktop.ini'
  ) {
    return false;
  }

  if (LITERATURE_ROOT_PATTERN.test(rel)) return true;
  if (VISIBLE_WORK_STAGE_ROOT_PATTERN.test(rel)) return true;
  if (/^Publication\//.test(rel)) return true;
  if (/^reports\//.test(rel)) return true;
  if (/^drafts\//.test(rel)) return true;
  if (/^(Promotion|Presentation)\//.test(rel)) return true;
  if (!rel.endsWith('.json')) return false;
  if (PIPELINE_LOG_PATTERN.test(rel)) return true;
  if (/(?:^|\/)cache\//.test(rel)) return true;

  return false;
}

export function classifyResearchArtifactPipelineStage(
  name: string,
  relativePath: string,
): ResearchArtifactPipelineStage {
  const rel = toResearchArtifactRelativePath(relativePath);

  if (LITERATURE_ROOT_PATTERN.test(rel)) return 'literature';
  if (/^Ideation\//.test(rel)) return 'ideation';
  if (/^Experiment\//.test(rel)) return 'experiment';
  if (/^(Promotion|Presentation)\//.test(rel)) return 'promotion';
  if (/^Publication\/(homepage|slide|slides)\//.test(rel)) return 'promotion';
  if (/^Publication\//.test(rel)) return 'publication';
  if (/^(reports|drafts)\//.test(rel)) return 'publication';

  if (rel.includes('/tools/') || name === 'load_instance.json') return 'ideation';
  if (name === 'github_search.json') return 'ideation';
  if (name.includes('download_arxiv')) return 'ideation';
  if (name === 'prepare_agent.json') return 'ideation';
  if (name.startsWith('idea_generation')) return 'ideation';
  if (name.includes('medical_evidence') || name.includes('medical_expert')) return 'ideation';
  if (name.includes('engineering_evidence') || name.includes('engineering_expert')) return 'ideation';

  if (name === 'repo_acquisition_agent.json') return 'experiment';
  if (name === 'code_survey_agent.json') return 'experiment';
  if (name === 'coding_plan_agent.json') return 'experiment';
  if (name.startsWith('machine_learning')) return 'experiment';
  if (name.startsWith('judge_agent')) return 'experiment';
  if (name.startsWith('experiment_analysis')) return 'experiment';
  if (/(?:^|\/)cache\//.test(rel)) return 'experiment';

  return 'unassigned';
}

export function countResearchStageArtifacts(
  artifacts: Array<Pick<ResearchArtifactFile, 'name' | 'relativePath'>>,
): ResearchStageArtifactCounts {
  const counts = createEmptyResearchStageArtifactCounts();

  artifacts.forEach((artifact) => {
    const stage = classifyResearchArtifactPipelineStage(artifact.name, artifact.relativePath);
    if (stage !== 'unassigned') {
      counts[stage] += 1;
    }
  });

  return counts;
}

export function collectResearchArtifactFiles(
  nodes: ProjectFileTreeNode[] | null | undefined,
  projectRoot?: string,
  hiddenNames: Iterable<string> = DEFAULT_RESEARCH_ARTIFACT_HIDDEN_NAMES,
): ResearchArtifactFile[] {
  const files: ResearchArtifactFile[] = [];
  const hidden = new Set(hiddenNames);
  if (!Array.isArray(nodes)) return files;

  const walk = (items: ProjectFileTreeNode[]) => {
    items.forEach((item) => {
      const path = item.relativePath || item.path || item.absolutePath || '';
      const relativePath = toResearchArtifactRelativePath(path, projectRoot);
      const name = item.name || basename(relativePath);

      if (item.type === 'file' && !hidden.has(name) && shouldCollectResearchArtifact(relativePath)) {
        files.push({
          name,
          relativePath,
          path: item.path,
          absolutePath: item.absolutePath,
        });
      }

      if (item.type === 'directory' && Array.isArray(item.children)) {
        walk(item.children);
      }
    });
  };

  walk(nodes);
  return files;
}

export function countResearchStageArtifactsFromFileTree(
  nodes: ProjectFileTreeNode[] | null | undefined,
  projectRoot?: string,
  hiddenNames: Iterable<string> = DEFAULT_RESEARCH_ARTIFACT_HIDDEN_NAMES,
) {
  return countResearchStageArtifacts(
    collectResearchArtifactFiles(nodes, projectRoot, hiddenNames),
  );
}
