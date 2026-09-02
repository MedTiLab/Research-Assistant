import type { Project } from '../types/app';

const FALLBACK_PROJECT_NAME = 'new-project';
const MAX_DISPLAY_NAME_CHARS = 16;
const MAX_FOLDER_NAME_CHARS = 48;
const DATE_DRAFT_PROJECT_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[ -]\d+)?$/;

const toChars = (value: string) => Array.from(value);

const normalizeSpaces = (value: string) => String(value || '').replace(/\s+/g, ' ').trim();

export const getLocalDateProjectName = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const makeUnique = (baseName: string, existingNames: string[], separator: string) => {
  const normalizedExisting = new Set(
    existingNames
      .map((name) => String(name || '').trim().toLowerCase())
      .filter(Boolean),
  );

  if (!normalizedExisting.has(baseName.toLowerCase())) {
    return baseName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName}${separator}${index}`;
    if (!normalizedExisting.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${baseName}${separator}${Date.now()}`;
};

export const getPathBaseName = (value: unknown) => {
  const parts = String(value || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
};

export const deriveDraftProjectDisplayName = (prompt: string, projects: Project[] = []) => {
  const normalizedPrompt = normalizeSpaces(prompt);
  const firstSentence = normalizeSpaces(
    normalizedPrompt.split(/[\r\n.!?\u3002\uff01\uff1f]/)[0] || normalizedPrompt,
  );
  const titleSource = normalizeSpaces(firstSentence.replace(/^[-*#>/\\\s]+/, '')) || normalizedPrompt;
  const trimmedTitle = toChars(titleSource).slice(0, MAX_DISPLAY_NAME_CHARS).join('').trim();
  const baseName = trimmedTitle || FALLBACK_PROJECT_NAME;
  const existingDisplayNames = projects
    .flatMap((project) => [project.displayName, project.name])
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

  return makeUnique(baseName, existingDisplayNames, ' ');
};

export const deriveDraftProjectFolderName = (displayName: string, existingFolderNames: string[] = []) => {
  const normalizedName = normalizeSpaces(displayName).normalize('NFKC');
  const safeName = normalizedName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/^\.+/, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const baseName = toChars(safeName).slice(0, MAX_FOLDER_NAME_CHARS).join('').replace(/-+$/g, '') || FALLBACK_PROJECT_NAME;

  return makeUnique(baseName, existingFolderNames, '-');
};

export const deriveDefaultDraftProjectDisplayName = (projects: Project[] = []) => {
  const dateName = getLocalDateProjectName();
  const existingDisplayNames = projects
    .flatMap((project) => [project.displayName, project.name])
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

  return makeUnique(dateName, existingDisplayNames, ' ');
};

export const deriveDefaultDraftProjectFolderName = (existingFolderNames: string[] = []) =>
  makeUnique(getLocalDateProjectName(), existingFolderNames, '-');

export const projectHasAnySessions = (project: Project | null | undefined) => {
  if (!project) {
    return false;
  }

  const visibleSessionCount =
    (project.sessions?.length ?? 0) +
    (project.codexSessions?.length ?? 0) +
    (project.piSessions?.length ?? 0) +
    (project.openrouterSessions?.length ?? 0) +
    (project.localSessions?.length ?? 0);

  return visibleSessionCount > 0 || Number(project.sessionMeta?.total ?? 0) > 0;
};

export const isDefaultDraftProject = (project: Project | null | undefined) => {
  if (!project) {
    return false;
  }

  const displayName = String(project.displayName || '').trim();
  const folderName = getPathBaseName(project.fullPath || project.path || '');
  return DATE_DRAFT_PROJECT_PATTERN.test(displayName) || DATE_DRAFT_PROJECT_PATTERN.test(folderName);
};

export const isUnusedDefaultDraftProject = (project: Project | null | undefined) =>
  isDefaultDraftProject(project) && !projectHasAnySessions(project);

export const isDefaultConversationProject = (project: Project | null | undefined) =>
  project?.isDefaultWorkspace === true;

export const getDefaultConversationProject = (projects: Project[] = []) =>
  projects.find(isDefaultConversationProject) || null;

export const isConversationFolderProject = (
  project: Project | null | undefined,
): project is Project => Boolean(
  project?.name
  && !project.isDefaultWorkspace
  && !project.isConversationWorkspace,
);

export const resolvePreferredConversationFolder = (
  projects: Project[] = [],
  selectedProject: Project | null | undefined,
  rememberedProjectName?: string | null,
) => {
  if (isConversationFolderProject(selectedProject)) {
    return selectedProject;
  }

  if (!rememberedProjectName) {
    return null;
  }

  return projects.find((project) => (
    project.name === rememberedProjectName && isConversationFolderProject(project)
  )) || null;
};

export const createVirtualDefaultDraftProject = (): Project => ({
  name: '',
  displayName: getLocalDateProjectName(),
  fullPath: '',
  path: '',
  sessions: [],
  codexSessions: [],
  piSessions: [],
  openrouterSessions: [],
  localSessions: [],
  sessionMeta: { hasMore: false, total: 0 },
  __virtualDraftProject: true,
});

export const isVirtualDefaultDraftProject = (project: Project | null | undefined) =>
  Boolean(project?.__virtualDraftProject);

export const shouldCreateConversationWorkspace = (
  project: Project | null | undefined,
  session: { id?: string | null } | null | undefined,
) => (
  !project
  || isVirtualDefaultDraftProject(project)
  || (project.isDefaultWorkspace === true && !session?.id)
);

export const appendWorkspacePathSegment = (basePath: string, segment: string) => {
  const rawBase = String(basePath || '').trim() || '~';
  const trimmedBase = rawBase.replace(/[\\/]+$/g, '');

  if (rawBase === '~' || trimmedBase === '~') {
    return `~/${segment}`;
  }

  if (/^[A-Za-z]:$/.test(trimmedBase)) {
    return `${trimmedBase}\\${segment}`;
  }

  if (!trimmedBase) {
    return `/${segment}`;
  }

  const separator = rawBase.includes('\\') && !rawBase.includes('/') ? '\\' : '/';
  return `${trimmedBase}${separator}${segment}`;
};
