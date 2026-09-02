import type { TFunction } from 'i18next';
import type { Project } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';
import { getSessionDate, getSessionName, projectMatchesSearch, sessionMatchesSearch } from './utils';

export const SIDEBAR_SEARCH_CHAT_LIMIT = 8;
export const SIDEBAR_SEARCH_MATCHED_CHAT_LIMIT = 12;
export const SIDEBAR_SEARCH_PROJECT_LIMIT = 6;
export const SIDEBAR_SEARCH_SHORTCUT_COUNT = 9;

export type SidebarSearchActionId = 'newConversation' | 'conversationHistory';
export type SidebarSearchGroupId = 'chats' | 'projects' | 'actions';

export type SidebarSearchChatItem = {
  kind: 'chat';
  id: string;
  title: string;
  projectName: string;
  projectLabel: string;
  session: SessionWithProvider;
  shortcutIndex?: number;
};

export type SidebarSearchProjectItem = {
  kind: 'project';
  id: string;
  title: string;
  project: Project;
};

export type SidebarSearchActionItem = {
  kind: 'action';
  id: SidebarSearchActionId;
  title: string;
};

export type SidebarSearchItem =
  | SidebarSearchChatItem
  | SidebarSearchProjectItem
  | SidebarSearchActionItem;

export type SidebarSearchGroup = {
  id: SidebarSearchGroupId;
  items: SidebarSearchItem[];
};

type Translate = TFunction;

type BuildSidebarSearchPaletteOptions = {
  projects: Project[];
  getSessions: (project: Project) => SessionWithProvider[];
  query: string;
  t: Translate;
};

const ACTION_TITLE_KEYS: Record<SidebarSearchActionId, string> = {
  newConversation: 'searchPalette.newConversation',
  conversationHistory: 'searchPalette.conversationHistory',
};

export function isApplePlatform(
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function formatModShortcut(isApple: boolean, key: string): string {
  return isApple ? `⌘${key}` : `Ctrl+${key}`;
}

export function flattenSidebarSearchItems(groups: SidebarSearchGroup[]): SidebarSearchItem[] {
  return groups.flatMap((group) => group.items);
}

function projectLabel(project: Project, t: Translate): string {
  return project.isDefaultWorkspace || project.isConversationWorkspace
    ? String(t('projects.conversations'))
    : project.displayName || project.name;
}

function buildChatItem(
  project: Project,
  session: SessionWithProvider,
  t: Translate,
  shortcutIndex?: number,
): SidebarSearchChatItem {
  return {
    kind: 'chat',
    id: `chat:${project.name}:${session.__provider}:${session.id}`,
    title: getSessionName(session, t),
    projectName: project.name,
    projectLabel: projectLabel(project, t),
    session,
    shortcutIndex,
  };
}

function collectChats(
  projects: Project[],
  getSessions: (project: Project) => SessionWithProvider[],
): Array<{ project: Project; session: SessionWithProvider }> {
  return projects
    .flatMap((project) => getSessions(project).map((session) => ({ project, session })))
    .sort(
      (left, right) => getSessionDate(right.session).getTime() - getSessionDate(left.session).getTime(),
    );
}

function chatMatchesQuery(
  project: Project,
  session: SessionWithProvider,
  normalizedQuery: string,
  t: Translate,
): boolean {
  if (!normalizedQuery) {
    return true;
  }

  return sessionMatchesSearch(session, normalizedQuery, t)
    || projectMatchesSearch(project, normalizedQuery)
    || projectLabel(project, t).toLowerCase().includes(normalizedQuery);
}

function buildActionItems(
  query: string,
  t: Translate,
): SidebarSearchActionItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const actionIds: SidebarSearchActionId[] = ['newConversation', 'conversationHistory'];

  return actionIds
    .map((id) => ({
      kind: 'action' as const,
      id,
      title: String(t(ACTION_TITLE_KEYS[id])),
    }))
    .filter((item) => !normalizedQuery || item.title.toLowerCase().includes(normalizedQuery));
}

export function buildSidebarSearchPalette({
  projects,
  getSessions,
  query,
  t,
}: BuildSidebarSearchPaletteOptions): SidebarSearchGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  const isBrowsing = normalizedQuery.length === 0;
  const chatLimit = isBrowsing ? SIDEBAR_SEARCH_CHAT_LIMIT : SIDEBAR_SEARCH_MATCHED_CHAT_LIMIT;

  const chats = collectChats(projects, getSessions)
    .filter(({ project, session }) => chatMatchesQuery(project, session, normalizedQuery, t))
    .slice(0, chatLimit)
    .map(({ project, session }, index) =>
      buildChatItem(
        project,
        session,
        t,
        isBrowsing && index < SIDEBAR_SEARCH_SHORTCUT_COUNT ? index + 1 : undefined,
      ),
    );

  const matchedProjects = isBrowsing
    ? []
    : projects
        .filter((project) => !project.isDefaultWorkspace && !project.isConversationWorkspace)
        .filter((project) => (
          projectMatchesSearch(project, normalizedQuery)
          || projectLabel(project, t).toLowerCase().includes(normalizedQuery)
        ))
        .slice(0, SIDEBAR_SEARCH_PROJECT_LIMIT)
        .map((project) => ({
          kind: 'project' as const,
          id: `project:${project.name}`,
          title: projectLabel(project, t),
          project,
        }));

  const actions = buildActionItems(query, t);
  const groups: SidebarSearchGroup[] = [];

  if (chats.length > 0) {
    groups.push({ id: 'chats', items: chats });
  }
  if (matchedProjects.length > 0) {
    groups.push({ id: 'projects', items: matchedProjects });
  }
  if (actions.length > 0) {
    groups.push({ id: 'actions', items: actions });
  }

  return groups;
}
