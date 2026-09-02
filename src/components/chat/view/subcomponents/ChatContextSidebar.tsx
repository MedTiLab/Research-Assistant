import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  ExternalLink,
  FileOutput,
  FolderSearch,
  Folders,
  GitBranch,
  Loader2,
  MessageCircleQuestion,
  Maximize2,
  Minimize2,
  Globe2,
  type LucideIcon,
} from 'lucide-react';

import FileTree from '../../../FileTree';
import GitPanel from '../../../GitPanel';
import SurveyPage from '../../../survey/view/SurveyPage';
import ConversationMemoryPanel from './ConversationMemoryPanel';
import ComputeNodeSelector from './ComputeNodeSelector';
import SimpleBrowser from './SimpleBrowser';
import { cn } from '../../../../lib/utils';
import { useDeviceSettings } from '../../../../hooks/useDeviceSettings';
import { useTheme } from '../../../../contexts/ThemeContext';
import { api } from '../../../../utils/api';
import { PROJECT_FILE_MOVED_EVENT, type ProjectFileMovedDetail } from '../../../../utils/projectFileEvents';
import type { ProjectFileChatContextItem } from '../../../../utils/projectFileChatContext';
import type { AppTab, Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import {
  getSidebarIconRailWidth,
  SIDEBAR_ICON_RAIL_WIDTH,
} from '../../../sidebar/view/subcomponents/sidebarNavTiles';
import type { Reference } from '../../../references/types';
import {
  VISIBLE_CHAT_SIDEBAR_TABS,
  normalizeChatSidebarTab,
  type ChatMessage,
  type ChatSidebarTab,
} from '../../types/types';
import { convertSessionMessages } from '../../utils/messageTransforms';
import {
  deriveSessionContextSummary,
  mergeDistinctChatMessages,
  type SessionContextFileItem,
  type SessionContextOutputItem,
  type SessionReviewState,
} from '../../utils/sessionContextSummary';
import { agentStatusLabel, usePiSessionState } from '../../../agent-work/usePiSessionState';
import AgentWorkDetails from '../../../agent-work/AgentWorkDetails';
import type { AgentWorkItem } from '../../../agent-work/useAgentWork';

type ReviewFilter = 'all' | 'unread' | 'reviewed';
type SidebarSectionKey = 'memory' | 'context' | 'tasks' | 'review';
type SidebarSectionState = Record<SidebarSectionKey, boolean>;
type SectionTone = 'context' | 'tasks' | 'review';

const CHAT_LAYOUT_ROOT_SELECTOR = '[data-chat-layout-root]';

function resolveResizeContainerWidth(aside: HTMLElement | null) {
  if (!aside) {
    return window.innerWidth;
  }

  const layoutRoot = aside.closest(CHAT_LAYOUT_ROOT_SELECTOR);
  if (layoutRoot instanceof HTMLElement) {
    return layoutRoot.clientWidth;
  }

  return aside.parentElement?.clientWidth ?? window.innerWidth;
}

const SIDEBAR_WIDTH_STORAGE_KEY = 'chat-session-context-width';
const BROWSER_WIDTH_STORAGE_KEY = 'chat-simple-browser-width';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'chat-session-context-collapsed';
const SIDEBAR_SECTIONS_STORAGE_KEY = 'chat-session-context-sections';
const DEFAULT_SIDEBAR_WIDTH = 480;
const DEFAULT_BROWSER_WIDTH = 620;
const MIN_SIDEBAR_WIDTH = 360;
const MAX_SIDEBAR_WIDTH = 840;
const MIN_CHAT_AREA_WIDTH = 400;
const SECTION_STYLES: Record<SectionTone, {
  panel: string;
  glow: string;
  icon: string;
  count: string;
}> = {
  context: {
    panel: 'border-emerald-200/70 bg-gradient-to-b from-emerald-50/40 via-background to-background dark:border-emerald-900/40 dark:from-emerald-950/10',
    glow: 'from-emerald-300/60 via-emerald-200/20 to-transparent dark:from-emerald-700/50 dark:via-emerald-900/20',
    icon: 'border-emerald-200/80 bg-emerald-50/95 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200',
    count: 'border-emerald-200/80 bg-emerald-50/95 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200',
  },
  tasks: {
    panel: 'border-sky-200/70 bg-gradient-to-b from-sky-50/40 via-background to-background dark:border-sky-900/40 dark:from-sky-950/10',
    glow: 'from-sky-300/60 via-sky-200/20 to-transparent dark:from-sky-700/50 dark:via-sky-900/20',
    icon: 'border-sky-200/80 bg-sky-50/95 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200',
    count: 'border-sky-200/80 bg-sky-50/95 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200',
  },
  review: {
    panel: 'border-amber-200/70 bg-gradient-to-b from-amber-50/40 via-background to-background dark:border-amber-900/40 dark:from-amber-950/10',
    glow: 'from-amber-300/60 via-amber-200/20 to-transparent dark:from-amber-700/50 dark:via-amber-900/20',
    icon: 'border-amber-200/80 bg-amber-50/95 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
    count: 'border-amber-200/80 bg-amber-50/95 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
  },
};

interface ChatContextSidebarProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  newSessionMode?: SessionMode;
  chatMessages: ChatMessage[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onSummarizeMemory?: () => void;
  onStartWorkspaceQa?: (project: Project, prompt: string, options?: { projectFiles?: ProjectFileChatContextItem[] }) => void;
  onChatFromReference?: (ref: Reference) => void;
  onStartTask?: (prompt?: string, task?: {
    id?: string | number | null;
    title?: string | null;
    stage?: string | null;
  } | null) => void;
  activeSidebarTab?: ChatSidebarTab;
  onSidebarTabChange?: (tab: ChatSidebarTab) => void;
  onNavigateAppTab?: (tab: AppTab) => void;
  onLayoutChange?: (layout: { width: number; collapsed: boolean }) => void;
  /** Increment to expand a fully hidden sidebar from outside (e.g. header button). */
  expandSignal?: number;
  consultationContent?: ReactNode;
}

const SIDEBAR_TAB_META: Record<ChatSidebarTab, { labelKey: string; icon: LucideIcon }> = {
  context: { labelKey: 'sessionContext.sidebarTabs.context', icon: FolderSearch },
  consultation: { labelKey: 'selectionConsultation.title', icon: MessageCircleQuestion },
  files: { labelKey: 'sessionContext.sidebarTabs.files', icon: Folders },
  browser: { labelKey: 'sessionContext.sidebarTabs.browser', icon: Globe2 },
  survey: { labelKey: 'common:tabs.survey', icon: BookOpen },
  git: { labelKey: 'sessionContext.sidebarTabs.git', icon: GitBranch },
};

type SidebarNavEntry = { kind: 'tab'; id: ChatSidebarTab };

const SIDEBAR_NAV_SEQUENCE: SidebarNavEntry[] = VISIBLE_CHAT_SIDEBAR_TABS.map((id) => ({ kind: 'tab', id }));

type MovedFileTarget = {
  relativePath: string;
  absolutePath: string | null;
  name: string;
};

type MovedFileState = Record<string, MovedFileTarget>;

const compareFileItemsByLastSeen = <T extends { lastSeenAt: string; name: string }>(left: T, right: T) => {
  if (left.lastSeenAt !== right.lastSeenAt) {
    return right.lastSeenAt.localeCompare(left.lastSeenAt);
  }

  return left.name.localeCompare(right.name);
};

const getLatestTimestamp = (...values: Array<string | null | undefined>) => {
  const sortedValues = values.filter((value): value is string => Boolean(value)).sort();
  return sortedValues[sortedValues.length - 1];
};

const mergeReasons = (left: string[], right: string[]) => Array.from(new Set([...left, ...right])).sort();

const isOutputUnread = (relativePath: string, lastSeenAt: string, reviews: SessionReviewState) => {
  const review = reviews[relativePath];
  if (!review?.reviewedAt) {
    return true;
  }

  return review.reviewedAt < lastSeenAt;
};

const resolveMovedFile = <T extends SessionContextFileItem | SessionContextOutputItem>(
  item: T,
  movedFiles: MovedFileState,
): T => {
  let nextRelativePath = item.relativePath;
  let nextAbsolutePath = item.absolutePath || null;
  let nextName = item.name;
  const visited = new Set<string>();

  while (!visited.has(nextRelativePath)) {
    visited.add(nextRelativePath);
    const movedFile = movedFiles[nextRelativePath];
    if (!movedFile) {
      break;
    }

    nextRelativePath = movedFile.relativePath;
    nextAbsolutePath = movedFile.absolutePath ?? nextAbsolutePath;
    nextName = movedFile.name || nextName;
  }

  return {
    ...item,
    key: nextRelativePath,
    name: nextName,
    relativePath: nextRelativePath,
    absolutePath: nextAbsolutePath,
  } as T;
};

const mergeContextFileItem = (
  current: SessionContextFileItem,
  next: SessionContextFileItem,
): SessionContextFileItem => {
  const latestItem = next.lastSeenAt >= current.lastSeenAt ? next : current;

  return {
    key: current.relativePath,
    name: latestItem.name,
    relativePath: current.relativePath,
    absolutePath: latestItem.absolutePath || current.absolutePath || next.absolutePath || null,
    reasons: mergeReasons(current.reasons, next.reasons),
    count: current.count + next.count,
    lastSeenAt: getLatestTimestamp(current.lastSeenAt, next.lastSeenAt) || current.lastSeenAt,
  };
};

const mergeOutputFileItem = (
  current: SessionContextOutputItem,
  next: SessionContextOutputItem,
): SessionContextOutputItem => {
  const latestItem = next.lastSeenAt >= current.lastSeenAt ? next : current;

  return {
    key: current.relativePath,
    name: latestItem.name,
    relativePath: current.relativePath,
    absolutePath: latestItem.absolutePath || current.absolutePath || next.absolutePath || null,
    reasons: mergeReasons(current.reasons, next.reasons),
    count: current.count + next.count,
    lastSeenAt: getLatestTimestamp(current.lastSeenAt, next.lastSeenAt) || current.lastSeenAt,
    unread: current.unread || next.unread,
  };
};

const buildDisplayContextFiles = (
  items: SessionContextFileItem[],
  movedFiles: MovedFileState,
) => {
  const merged = new Map<string, SessionContextFileItem>();

  items.forEach((item) => {
    const resolvedItem = resolveMovedFile(item, movedFiles);
    const existingItem = merged.get(resolvedItem.relativePath);
    merged.set(
      resolvedItem.relativePath,
      existingItem ? mergeContextFileItem(existingItem, resolvedItem) : resolvedItem,
    );
  });

  return Array.from(merged.values()).sort(compareFileItemsByLastSeen);
};

const buildDisplayOutputFiles = (
  items: SessionContextOutputItem[],
  movedFiles: MovedFileState,
  reviews: SessionReviewState,
) => {
  const merged = new Map<string, SessionContextOutputItem>();

  items.forEach((item) => {
    const resolvedItem = resolveMovedFile(item, movedFiles);
    const existingItem = merged.get(resolvedItem.relativePath);
    merged.set(
      resolvedItem.relativePath,
      existingItem ? mergeOutputFileItem(existingItem, resolvedItem) : resolvedItem,
    );
  });

  return Array.from(merged.values())
    .map((item) => ({
      ...item,
      unread: isOutputUnread(item.relativePath, item.lastSeenAt, reviews),
    }))
    .sort((left, right) => {
      if (left.unread !== right.unread) {
        return left.unread ? -1 : 1;
      }

      return compareFileItemsByLastSeen(left, right);
    });
};

const updateMovedFiles = (
  current: MovedFileState,
  detail: ProjectFileMovedDetail,
) => {
  const oldRelativePath = String(detail.oldRelativePath || '').trim();
  const newRelativePath = String(detail.newRelativePath || '').trim();
  if (!oldRelativePath || !newRelativePath || oldRelativePath === newRelativePath) {
    return current;
  }

  const nextTarget: MovedFileTarget = {
    relativePath: newRelativePath,
    absolutePath: detail.newAbsolutePath ?? null,
    name: detail.name || newRelativePath.split('/').pop() || newRelativePath,
  };

  const nextState: MovedFileState = { ...current };
  Object.entries(nextState).forEach(([sourcePath, target]) => {
    if (sourcePath === oldRelativePath || target.relativePath === oldRelativePath) {
      nextState[sourcePath] = {
        relativePath: newRelativePath,
        absolutePath: nextTarget.absolutePath ?? target.absolutePath ?? null,
        name: nextTarget.name || target.name,
      };
    }
  });

  nextState[oldRelativePath] = nextTarget;
  return nextState;
};

const remapReviewsForMovedFile = (
  current: SessionReviewState,
  detail: ProjectFileMovedDetail,
) => {
  const oldRelativePath = String(detail.oldRelativePath || '').trim();
  const newRelativePath = String(detail.newRelativePath || '').trim();
  if (!oldRelativePath || !newRelativePath || oldRelativePath === newRelativePath) {
    return current;
  }

  const oldReview = current[oldRelativePath];
  const newReview = current[newRelativePath];
  if (!oldReview && !newReview) {
    return current;
  }

  const reviewedAt = getLatestTimestamp(oldReview?.reviewedAt, newReview?.reviewedAt) || undefined;
  const lastSeenAt = getLatestTimestamp(oldReview?.lastSeenAt, newReview?.lastSeenAt) || undefined;
  const lastReviewedSeenAt = getLatestTimestamp(oldReview?.lastReviewedSeenAt, newReview?.lastReviewedSeenAt) || undefined;

  const nextReviews: SessionReviewState = { ...current };
  delete nextReviews[oldRelativePath];

  if (reviewedAt || lastSeenAt || lastReviewedSeenAt) {
    nextReviews[newRelativePath] = {
      reviewedAt,
      lastSeenAt,
      lastReviewedSeenAt,
    };
  } else {
    delete nextReviews[newRelativePath];
  }

  return nextReviews;
};

const formatTimeLabel = (value: string, locale?: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const ItemBadge = ({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'unread' }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm',
      tone === 'unread'
        ? 'border-emerald-200/80 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
        : 'border-border/70 bg-background/90 text-muted-foreground',
    )}
  >
    {children}
  </span>
);

const OpenFileButton = ({ title }: { title: string }) => (
  <span
    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-background/95 text-muted-foreground shadow-sm transition-colors group-hover:border-primary/30 group-hover:text-foreground"
    title={title}
  >
    <ExternalLink className="h-3 w-3" />
  </span>
);

const StatCard = ({
  label,
  value,
  accentClassName,
  hint,
  hintTone = 'muted',
}: {
  label: string;
  value: ReactNode;
  accentClassName: string;
  hint?: string;
  hintTone?: 'muted' | 'amber';
}) => (
  <div className="relative overflow-hidden rounded-lg border border-border/60 bg-gradient-to-b from-background via-background to-muted/30 px-3 py-2.5 shadow-sm">
    <div className={cn('absolute -right-4 -top-4 h-12 w-12 rounded-full blur-2xl opacity-45', accentClassName)} />
    <div className={cn('absolute inset-x-0 top-0 h-px opacity-80', accentClassName)} />
    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
    <div className="mt-1 truncate text-[15px] font-semibold tracking-tight text-foreground">{value}</div>
    {hint ? (
      <div
        className={cn(
          'mt-1 truncate text-[10px] leading-[1.3]',
          hintTone === 'amber'
            ? 'font-medium text-amber-700 dark:text-amber-300'
            : 'text-muted-foreground/80',
        )}
        title={hint}
      >
        {hint}
      </div>
    ) : null}
  </div>
);

const SectionCountBadge = ({ count, tone }: { count: number; tone: SectionTone }) => (
  <span className={cn('inline-flex min-w-[1.75rem] items-center justify-center rounded-md border px-2 py-0.5 text-[10px] font-semibold shadow-sm', SECTION_STYLES[tone].count)}>
    {count}
  </span>
);

const SIDEBAR_TOOLBAR_ICON_CLASS = 'h-3.5 w-3.5';
const SIDEBAR_TOGGLE_ICON_CLASS = 'h-3.5 w-3.5';
const SIDEBAR_TOOLBAR_HEADER_CLASS =
  'relative z-30 flex-shrink-0 border-b border-border/60 px-2 py-1.5';
const SIDEBAR_TOOLBAR_ROW_CLASS = 'flex h-7 w-full items-center gap-0.5';
const SIDEBAR_TOOLBAR_BUTTON_CLASS = cn(
  'relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors',
  'hover:bg-accent/80 hover:text-foreground',
);

const NavGroupButton = ({
  title,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    aria-current={active ? 'page' : undefined}
    className={cn(
      SIDEBAR_TOOLBAR_BUTTON_CLASS,
      active && 'bg-primary/12 text-primary shadow-sm',
      disabled && 'cursor-not-allowed text-muted-foreground/60 hover:text-muted-foreground/60',
    )}
  >
    {children}
  </button>
);

const SectionHeader = ({
  title,
  count,
  tone,
  icon: Icon,
  collapsed,
  onToggle,
  actions,
}: {
  title: string;
  count: number;
  tone: SectionTone;
  icon: LucideIcon;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) => (
  <>
    <div className="mb-3 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border shadow-sm', SECTION_STYLES[tone].icon)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12px] font-semibold tracking-[0.08em] text-foreground">{title}</span>
            <SectionCountBadge count={count} tone={tone} />
          </div>
        </div>
        {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {actions}
    </div>
    {!collapsed ? <div className={cn('mb-3 h-px bg-gradient-to-r', SECTION_STYLES[tone].glow)} /> : null}
  </>
);

const ItemButton = ({
  label,
  detail,
  meta,
  unread = false,
  onClick,
  compact = false,
  action,
}: {
  label: string;
  detail?: string;
  meta?: ReactNode;
  unread?: boolean;
  onClick?: () => void;
  compact?: boolean;
  action?: ReactNode;
}) => {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group w-full rounded-lg border border-border/60 bg-gradient-to-r from-background via-background to-muted/20 px-2.5 py-2 text-left shadow-sm transition-all hover:border-border hover:from-accent/20 hover:to-accent/10"
      >
        <div className="flex items-center gap-2.5">
          <span className={cn('h-2 w-2 flex-shrink-0 rounded-full shadow-sm', unread ? 'bg-emerald-500' : 'bg-emerald-500/70')} />
          <div className="min-w-0 flex-1 truncate text-[12px] leading-5 text-foreground">
            <span className="font-semibold">{label}</span>
          </div>
          {meta ? <div className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap pl-1">{meta}</div> : null}
          {action ? <div className="flex-shrink-0">{action}</div> : null}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-lg border border-border/60 bg-gradient-to-r from-background via-background to-muted/20 px-3 py-2 text-left shadow-sm transition-all hover:border-border hover:from-accent/20 hover:to-accent/10"
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${unread ? 'bg-emerald-500' : 'bg-emerald-500/70'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 line-clamp-1 break-all text-sm font-semibold leading-5 text-foreground">{label}</div>
            {action ? <div className="flex-shrink-0">{action}</div> : null}
          </div>
          {detail && (
            <div className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-muted-foreground">
              {detail}
            </div>
          )}
          {meta && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {meta}
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

export default function ChatContextSidebar({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  newSessionMode = 'research',
  chatMessages,
  onFileOpen,
  onSummarizeMemory,
  onStartWorkspaceQa,
  onChatFromReference,
  onStartTask,
  activeSidebarTab = 'files',
  onSidebarTabChange,
  onLayoutChange,
  expandSignal = 0,
  consultationContent,
}: ChatContextSidebarProps) {
  const { t, i18n } = useTranslation(['chat', 'common']);
  const { uiFontScale } = useTheme();
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const [fetchedMessages, setFetchedMessages] = useState<ChatMessage[]>([]);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<SessionReviewState>({});
  const [movedFiles, setMovedFiles] = useState<MovedFileState>({});
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_SIDEBAR_WIDTH;
    }
    const rawValue = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = rawValue ? Number.parseInt(rawValue, 10) : NaN;
    return Number.isFinite(parsed) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed)) : DEFAULT_SIDEBAR_WIDTH;
  });
  const [browserWidth, setBrowserWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_BROWSER_WIDTH;
    }
    const rawValue = window.localStorage.getItem(BROWSER_WIDTH_STORAGE_KEY);
    const parsed = rawValue ? Number.parseInt(rawValue, 10) : NaN;
    return Number.isFinite(parsed) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed)) : DEFAULT_BROWSER_WIDTH;
  });
  const [isCollapsed, setIsCollapsed] = useState(() => (
    typeof window !== 'undefined'
      && window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  ));
  const [collapsedSections, setCollapsedSections] = useState<SidebarSectionState>(() => {
    if (typeof window === 'undefined') {
      return { memory: false, context: false, tasks: false, review: false };
    }
    try {
      const rawValue = window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY);
      const parsed = rawValue ? JSON.parse(rawValue) : null;
      return {
        memory: parsed?.memory === true,
        context: parsed?.context === true,
        tasks: parsed?.tasks === true,
        review: parsed?.review === true,
      };
    } catch {
      return { memory: false, context: false, tasks: false, review: false };
    }
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isBrowserExpanded, setIsBrowserExpanded] = useState(false);
  const [browserExpandedWidth, setBrowserExpandedWidth] = useState(0);
  const asideRef = useRef<HTMLElement | null>(null);
  const isSidebarCollapsed = !isMobile && isCollapsed;
  const fixedRailWidth = getSidebarIconRailWidth(uiFontScale);
  const displayedSidebarWidth = isBrowserExpanded
    ? Math.max(MIN_SIDEBAR_WIDTH, browserExpandedWidth)
    : activeSidebarTab === 'browser'
      ? browserWidth
      : sidebarWidth;

  useEffect(() => {
    if (isMobile) {
      onLayoutChange?.({ width: 0, collapsed: true });
      return;
    }

    onLayoutChange?.({
      width: isSidebarCollapsed ? fixedRailWidth : displayedSidebarWidth + fixedRailWidth,
      collapsed: isSidebarCollapsed,
    });
  }, [displayedSidebarWidth, fixedRailWidth, isMobile, isSidebarCollapsed, onLayoutChange]);

  useEffect(() => {
    if (expandSignal <= 0 || isMobile) return;
    setIsCollapsed(false);
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, '0');
  }, [expandSignal, isMobile]);

  const availableSidebarTabs = useMemo(
    () => VISIBLE_CHAT_SIDEBAR_TABS.map((id) => ({ id, ...SIDEBAR_TAB_META[id] })),
    [],
  );
  const visibleNavEntries = useMemo(
    () => SIDEBAR_NAV_SEQUENCE.filter((entry) => {
      if (entry.kind === 'tab') {
        return availableSidebarTabs.some((tab) => tab.id === entry.id);
      }
      return true;
    }),
    [availableSidebarTabs],
  );
  const normalizedSidebarTab = normalizeChatSidebarTab(activeSidebarTab);
  const effectiveSidebarTab = normalizedSidebarTab;

  useEffect(() => {
    if (effectiveSidebarTab !== 'browser' || isMobile || isSidebarCollapsed) {
      setIsBrowserExpanded(false);
    }
  }, [effectiveSidebarTab, isMobile, isSidebarCollapsed]);

  useEffect(() => {
    if (!isBrowserExpanded || typeof window === 'undefined') {
      return undefined;
    }

    const updateExpandedWidth = () => {
      setBrowserExpandedWidth(Math.max(
        MIN_SIDEBAR_WIDTH,
        resolveResizeContainerWidth(asideRef.current) - fixedRailWidth,
      ));
    };
    const layoutRoot = asideRef.current?.closest(CHAT_LAYOUT_ROOT_SELECTOR);
    const resizeObserver = layoutRoot instanceof HTMLElement && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateExpandedWidth)
      : null;
    updateExpandedWidth();
    resizeObserver?.observe(layoutRoot as HTMLElement);
    window.addEventListener('resize', updateExpandedWidth);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateExpandedWidth);
    };
  }, [fixedRailWidth, isBrowserExpanded]);

  const effectiveSessionId = selectedSession?.id || currentSessionId || null;
  const effectiveProvider = (selectedSession?.__provider as SessionProvider | undefined) || provider;
  const projectName = selectedProject?.name || '';
  const projectPath = selectedProject?.fullPath || selectedProject?.path || '';
  const { state: agentState, error: agentStateError } = usePiSessionState(projectName, effectiveSessionId, effectiveProvider === 'pi');
  const [taskDetail, setTaskDetail] = useState<AgentWorkItem | null>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);
  useEffect(() => { setTaskDetail(null); setShowAllTasks(false); }, [projectName, effectiveSessionId]);

  useEffect(() => {
    setMovedFiles({});
  }, [projectName]);

  useEffect(() => {
    let cancelled = false;

    const loadFullTrace = async () => {
      if (!selectedProject || !effectiveSessionId) {
        setFetchedMessages([]);
        setTraceError(null);
        return;
      }

      setIsLoadingTrace(true);
      setTraceError(null);

      try {
        const response = await api.sessionMessages(projectName, effectiveSessionId, null, 0, effectiveProvider);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
        if (!cancelled) {
          setFetchedMessages(convertSessionMessages(rawMessages));
        }
      } catch (error) {
        if (!cancelled) {
          setFetchedMessages([]);
          setTraceError(error instanceof Error ? error.message : 'Failed to load full session trace.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTrace(false);
        }
      }
    };

    void loadFullTrace();

    return () => {
      cancelled = true;
    };
  }, [effectiveProvider, effectiveSessionId, projectName, projectPath, selectedProject]);

  useEffect(() => {
    let cancelled = false;

    const loadReviews = async () => {
      if (!selectedProject || !effectiveSessionId) {
        setReviews({});
        return;
      }

      try {
        const response = await api.sessionContextReview(projectName, effectiveSessionId);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!cancelled) {
          setReviews(data?.reviews && typeof data.reviews === 'object' ? data.reviews : {});
        }
      } catch {
        if (!cancelled) {
          setReviews({});
        }
      }
    };

    void loadReviews();

    return () => {
      cancelled = true;
    };
  }, [effectiveSessionId, projectName, selectedProject]);

  const mergedMessages = useMemo(
    () => mergeDistinctChatMessages(fetchedMessages, chatMessages),
    [chatMessages, fetchedMessages],
  );

  const summary = useMemo(
    () => deriveSessionContextSummary(mergedMessages, projectPath, reviews, agentState),
    [mergedMessages, projectPath, reviews, agentState],
  );

  const displaySummary = useMemo(() => {
    const contextFiles = buildDisplayContextFiles(summary.contextFiles, movedFiles);
    const outputFiles = buildDisplayOutputFiles(summary.outputFiles, movedFiles, reviews);

    return {
      ...summary,
      contextFiles,
      outputFiles,
      unreadCount: outputFiles.filter((item) => item.unread).length,
    };
  }, [movedFiles, reviews, summary]);

  const filteredOutputFiles = useMemo(() => {
    if (reviewFilter === 'unread') {
      return displaySummary.outputFiles.filter((item) => item.unread);
    }
    if (reviewFilter === 'reviewed') {
      return displaySummary.outputFiles.filter((item) => !item.unread);
    }
    return displaySummary.outputFiles;
  }, [displaySummary.outputFiles, reviewFilter]);
  const contextItemCount = displaySummary.contextFiles.length + displaySummary.directories.length + displaySummary.skills.length + displaySummary.references.length;

  const modeLabel = useMemo(() => {
    const mode = selectedSession?.mode || newSessionMode;
    return mode === 'workspace_qa' ? t('session.mode.workspaceQa') : t('session.mode.research');
  }, [newSessionMode, selectedSession?.mode, t]);
  const providerLabel = useMemo(() => {
    if (effectiveProvider === 'codex') return t('messageTypes.codex');
    if (effectiveProvider === 'pi') return t('messageTypes.pi');
    return t('messageTypes.claude');
  }, [effectiveProvider, t]);
  const getTaskKindLabel = useCallback((kind: string) => {
    if (kind === 'todo') return t('sessionContext.kinds.todo');
    if (kind === 'skill') return t('sessionContext.kinds.skill');
    if (kind === 'directory') return t('sessionContext.kinds.directory');
    return t('sessionContext.kinds.task');
  }, [t]);
  const toggleBrowserExpanded = useCallback(() => {
    if (isMobile) {
      return;
    }
    if (isBrowserExpanded) {
      setIsBrowserExpanded(false);
      return;
    }
    setBrowserExpandedWidth(resolveResizeContainerWidth(asideRef.current));
    setIsBrowserExpanded(true);
  }, [isBrowserExpanded, isMobile]);
  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (isMobile) {
      return;
    }
    event.preventDefault();
    setIsResizing(true);
  }, [isMobile]);

  const persistReviews = useCallback(async (nextReviews: SessionReviewState) => {
    setReviews(nextReviews);

    if (!selectedProject || !effectiveSessionId) {
      return;
    }

    try {
      await api.updateSessionContextReview(projectName, effectiveSessionId, nextReviews);
    } catch {
      // Keep optimistic local state even if persistence fails.
    }
  }, [effectiveSessionId, projectName, selectedProject]);

  useEffect(() => {
    if (typeof window === 'undefined' || !projectName) {
      return undefined;
    }

    const handleProjectFileMoved = (event: Event) => {
      const detail = (event as CustomEvent<ProjectFileMovedDetail>).detail;
      if (!detail || detail.projectName !== projectName) {
        return;
      }

      setMovedFiles((current) => updateMovedFiles(current, detail));

      const nextReviews = remapReviewsForMovedFile(reviews, detail);
      if (nextReviews !== reviews) {
        void persistReviews(nextReviews);
      }
    };

    window.addEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileMoved);
    return () => window.removeEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileMoved);
  }, [persistReviews, projectName, reviews]);

  const markFileReviewed = useCallback(async (file: SessionContextOutputItem) => {
    const nextReviews: SessionReviewState = {
      ...reviews,
      [file.relativePath]: {
        reviewedAt: new Date().toISOString(),
        lastSeenAt: file.lastSeenAt,
        lastReviewedSeenAt: file.lastSeenAt,
      },
    };
    await persistReviews(nextReviews);
  }, [persistReviews, reviews]);
  const openContextFile = useCallback((file: SessionContextFileItem) => {
    const openPath = file.absolutePath || file.relativePath;
    onFileOpen?.(openPath);
  }, [onFileOpen]);
  const openReviewFile = useCallback(async (file: SessionContextOutputItem) => {
    const openPath = file.absolutePath || file.relativePath;
    if (file.unread) {
      await markFileReviewed(file);
    }
    onFileOpen?.(openPath);
  }, [markFileReviewed, onFileOpen]);
  const toggleSection = useCallback((key: SidebarSectionKey) => {
    setCollapsedSections((current) => {
      const nextValue = { ...current, [key]: !current[key] };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SIDEBAR_SECTIONS_STORAGE_KEY, JSON.stringify(nextValue));
      }
      return nextValue;
    });
  }, []);
  const handleSidebarTabSelect = useCallback((tab: ChatSidebarTab) => {
    onSidebarTabChange?.(normalizeChatSidebarTab(tab));
  }, [onSidebarTabChange]);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed);
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  }, []);

  const handleFixedFilesRailClick = useCallback(() => {
    if (!isSidebarCollapsed && effectiveSidebarTab === 'files') {
      setSidebarCollapsed(true);
      return;
    }
    handleSidebarTabSelect('files');
    setSidebarCollapsed(false);
  }, [effectiveSidebarTab, handleSidebarTabSelect, isSidebarCollapsed, setSidebarCollapsed]);

  const handleFixedBrowserRailClick = useCallback(() => {
    if (!isSidebarCollapsed && effectiveSidebarTab === 'browser') {
      setSidebarCollapsed(true);
      return;
    }
    handleSidebarTabSelect('browser');
    setSidebarCollapsed(false);
  }, [effectiveSidebarTab, handleSidebarTabSelect, isSidebarCollapsed, setSidebarCollapsed]);

  const handleFixedGitRailClick = useCallback(() => {
    if (!isSidebarCollapsed && effectiveSidebarTab === 'git') {
      setSidebarCollapsed(true);
      return;
    }
    handleSidebarTabSelect('git');
    setSidebarCollapsed(false);
  }, [effectiveSidebarTab, handleSidebarTabSelect, isSidebarCollapsed, setSidebarCollapsed]);

  const renderSidebarNavEntry = useCallback((entry: SidebarNavEntry) => {
    const meta = SIDEBAR_TAB_META[entry.id];
    const TabIcon = meta.icon;
    const isActive = entry.id === effectiveSidebarTab;
    const title = t(meta.labelKey);

    return (
      <NavGroupButton
        key={entry.id}
        title={title}
        active={isActive}
        onClick={() => handleSidebarTabSelect(entry.id)}
      >
        <TabIcon
          className={SIDEBAR_TOOLBAR_ICON_CLASS}
          strokeWidth={isActive ? 2.25 : 1.85}
        />
      </NavGroupButton>
    );
  }, [
    effectiveSidebarTab,
    handleSidebarTabSelect,
    t,
  ]);

  useEffect(() => {
    if (isMobile && isResizing) {
      setIsResizing(false);
    }
  }, [isMobile, isResizing]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const rightEdge = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      const containerWidth = resolveResizeContainerWidth(asideRef.current);
      const maxAvailableWidth = Math.max(MIN_SIDEBAR_WIDTH, containerWidth - MIN_CHAT_AREA_WIDTH);
      const effectiveMaxWidth = Math.min(MAX_SIDEBAR_WIDTH, maxAvailableWidth);
      const nextWidth = Math.min(effectiveMaxWidth, Math.max(MIN_SIDEBAR_WIDTH, rightEdge - event.clientX));
      if (effectiveSidebarTab === 'browser') {
        setBrowserWidth(nextWidth);
      } else {
        setSidebarWidth(nextWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [effectiveSidebarTab, isResizing]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(BROWSER_WIDTH_STORAGE_KEY, String(browserWidth));
  }, [browserWidth]);

  if (!selectedProject) {
    return null;
  }

  const toolbarNavEntries = isMobile
    ? visibleNavEntries
    : visibleNavEntries.filter((entry) => !['browser', 'files', 'git'].includes(entry.id));
  const showSidebarToolbar = toolbarNavEntries.length > 0
    || effectiveSidebarTab === 'browser'
    || (isLoadingTrace && effectiveSidebarTab === 'context');

  return (
    <div className="flex h-full min-h-0 flex-shrink-0 flex-row">
      {!isMobile && !isSidebarCollapsed && !isBrowserExpanded && (
        <div
          onMouseDown={handleResizeStart}
          className="relative z-10 -ml-px w-1.5 flex-shrink-0 self-stretch cursor-col-resize bg-transparent transition-[background-color,box-shadow] duration-150 hover:bg-primary/15 hover:shadow-[-4px_0_14px_-6px_rgba(16,163,127,0.32)] active:bg-primary/25 active:shadow-[-5px_0_16px_-6px_rgba(16,163,127,0.42)]"
          role="separator"
          aria-orientation="vertical"
          title={t('sessionContext.actions.resize')}
        />
      )}

      <aside
        ref={asideRef}
        className={cn(
          'flex h-full min-h-0 flex-col',
          isMobile && 'medical-context-sidebar w-full border-t border-border/60 bg-gradient-to-b from-card via-card to-muted/20 backdrop-blur',
          !isMobile && 'medical-context-sidebar min-w-0 flex-shrink-0 self-stretch overflow-hidden border-l border-border/50 bg-gradient-to-b from-card via-card to-muted/20 backdrop-blur shadow-[-8px_0_18px_-16px_rgba(15,23,42,0.42)] dark:shadow-[-8px_0_20px_-16px_rgba(0,0,0,0.68)]',
          !isMobile && isSidebarCollapsed && 'pointer-events-none !border-l-0',
        )}
        style={!isMobile ? { width: isSidebarCollapsed ? 0 : displayedSidebarWidth } : undefined}
        aria-hidden={!isMobile && isSidebarCollapsed ? true : undefined}
      >
        {showSidebarToolbar && (
        <div className={SIDEBAR_TOOLBAR_HEADER_CLASS}>
            <div className={SIDEBAR_TOOLBAR_ROW_CLASS}>
              <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                {toolbarNavEntries.map((entry) => renderSidebarNavEntry(entry))}
                {isLoadingTrace && effectiveSidebarTab === 'context' && (
                  <span
                    className={SIDEBAR_TOOLBAR_BUTTON_CLASS}
                    aria-label={t('sessionContext.status.loadingTrace', { defaultValue: 'Loading trace' })}
                    title={t('sessionContext.status.loadingTrace', { defaultValue: 'Loading trace' })}
                  >
                    <Loader2 className={`${SIDEBAR_TOOLBAR_ICON_CLASS} animate-spin`} />
                  </span>
                )}
              </nav>
              {!isMobile && effectiveSidebarTab === 'browser' && (
                <NavGroupButton
                  title={t(isBrowserExpanded ? 'sessionContext.actions.restoreBrowser' : 'sessionContext.actions.expandBrowser')}
                  onClick={toggleBrowserExpanded}
                >
                  {isBrowserExpanded ? (
                    <Minimize2 className={SIDEBAR_TOGGLE_ICON_CLASS} strokeWidth={1.9} />
                  ) : (
                    <Maximize2 className={SIDEBAR_TOGGLE_ICON_CLASS} strokeWidth={1.9} />
                  )}
                </NavGroupButton>
              )}
            </div>
        </div>
        )}

        {effectiveSidebarTab === 'context' && (
          <div className="flex-shrink-0 border-b border-border/60 px-4 py-3">
              <div className="flex items-center justify-end gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/85 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
                  <span className="uppercase tracking-[0.1em] opacity-70">{t('sessionContext.stats.mode')}</span>
                  <span className="text-foreground/90">{modeLabel}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/85 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
                  <span className="uppercase tracking-[0.1em] opacity-70">{t('sessionContext.stats.provider')}</span>
                  <span className="text-foreground/90">{providerLabel}</span>
                </span>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                <StatCard
                  label={t('sessionContext.stats.dataSources')}
                  value={displaySummary.directories.length + displaySummary.skills.length}
                  accentClassName="bg-emerald-400/75"
                  hint={t('sessionContext.stats.dataSourcesHint')}
                />
                <StatCard
                  label={t('sessionContext.stats.workingData')}
                  value={displaySummary.contextFiles.length}
                  accentClassName="bg-sky-400/75"
                  hint={t('sessionContext.stats.workingDataHint')}
                />
                <StatCard
                  label={t('sessionContext.stats.outputs')}
                  value={displaySummary.outputFiles.length}
                  accentClassName="bg-amber-400/75"
                  hint={
                    displaySummary.unreadCount > 0
                      ? t('sessionContext.stats.outputsHintUnread', { count: displaySummary.unreadCount })
                      : t('sessionContext.stats.outputsHintAllReviewed')
                  }
                  hintTone={displaySummary.unreadCount > 0 ? 'amber' : 'muted'}
                />
              </div>

              {effectiveProvider === 'codex' && (
                <div className="mt-3 rounded-lg border border-border/60 bg-muted/50 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground shadow-sm">
                  {t('sessionContext.codexNotice')}
                </div>
              )}

              {traceError && (
                <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[11px] leading-5 text-destructive shadow-sm">
                  {t('sessionContext.traceError')}
                </div>
              )}
          </div>
        )}

        {effectiveSidebarTab === 'consultation' && consultationContent ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {consultationContent}
          </div>
        ) : effectiveSidebarTab === 'context' ? (
          <div className="panel-scroll-area flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <ConversationMemoryPanel
          projectName={projectName}
          projectPath={projectPath}
          messages={mergedMessages}
          collapsed={collapsedSections.memory}
          onToggle={() => toggleSection('memory')}
          onSummarize={onSummarizeMemory}
          onFileOpen={onFileOpen}
        />

        <section className={`rounded-xl border p-3.5 ${SECTION_STYLES.context.panel} ${collapsedSections.context ? '' : 'flex min-h-[220px] flex-1 flex-col overflow-hidden'}`}>
          <SectionHeader
            title={t('sessionContext.sections.injectedContext')}
            count={contextItemCount}
            tone="context"
            icon={FolderSearch}
            collapsed={collapsedSections.context}
            onToggle={() => toggleSection('context')}
          />
          {!collapsedSections.context && (
          <div className="panel-scroll-area min-h-0 space-y-2 overflow-y-auto">
            {displaySummary.contextFiles.length === 0 && displaySummary.directories.length === 0 && displaySummary.skills.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                {t('sessionContext.empty.injectedContext')}
              </div>
            )}

            {displaySummary.contextFiles.slice(0, 6).map((file) => (
              <ItemButton
                key={file.key}
                label={file.name}
                compact
                onClick={() => openContextFile(file)}
                action={<OpenFileButton title={t('sessionContext.preview.open')} />}
                meta={
                  <>
                    {file.reasons[0] ? <ItemBadge>{file.reasons[0]}</ItemBadge> : null}
                    <ItemBadge>{file.count}x</ItemBadge>
                    <ItemBadge>{formatTimeLabel(file.lastSeenAt, i18n.language)}</ItemBadge>
                  </>
                }
              />
            ))}

            {displaySummary.directories.slice(0, 3).map((entry) => (
              <ItemButton
                key={entry.key}
                label={entry.label}
                detail={entry.detail}
                meta={<ItemBadge>{formatTimeLabel(entry.lastSeenAt, i18n.language)}</ItemBadge>}
              />
            ))}

            {displaySummary.skills.slice(0, 3).map((entry) => (
              <ItemButton
                key={entry.key}
                label={entry.label}
                detail={entry.detail}
                meta={<ItemBadge>{formatTimeLabel(entry.lastSeenAt, i18n.language)}</ItemBadge>}
              />
            ))}
            {displaySummary.references.map((entry) => <div key={entry.id} className="rounded-lg border border-border/60 px-2.5 py-2 text-xs">
              <div className="mb-1 text-[10px] text-muted-foreground">{entry.type}</div>
              {entry.url ? <a href={entry.url} target="_blank" rel="noreferrer" className="break-all underline">{entry.label}</a> : <span className="break-words">{entry.label}</span>}
            </div>)}
          </div>
          )}
        </section>

        <section className={`rounded-xl border p-3.5 ${SECTION_STYLES.tasks.panel}`}>
          <SectionHeader
            title={t('sessionContext.sections.taskContext')}
            count={displaySummary.tasks.length}
            tone="tasks"
            icon={ClipboardList}
            collapsed={collapsedSections.tasks}
            onToggle={() => toggleSection('tasks')}
          />
          {!collapsedSections.tasks && (
          <div className="space-y-1.5">
            {agentStateError && <p role="status" className="text-xs text-amber-600">{i18n.language.startsWith('zh') ? '任务状态暂未同步：' : 'Task state unavailable: '}{agentStateError}</p>}
            {displaySummary.plan?.plan && <details className="mb-2 rounded-lg border border-border/60 p-2 text-xs">
              <summary className="cursor-pointer font-semibold">{displaySummary.plan.title || (i18n.language.startsWith('zh') ? '当前计划' : 'Current plan')} · {agentStatusLabel(displaySummary.plan.status, i18n.language.startsWith('zh'))}</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{displaySummary.plan.plan}</pre>
            </details>}
            {displaySummary.tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                {t('sessionContext.empty.taskContext')}
              </div>
            ) : (
              (showAllTasks ? displaySummary.tasks : displaySummary.tasks.slice(0, 6)).map((entry) => (
              <button type="button"
                  key={entry.key}
                  disabled={effectiveProvider !== 'pi' || !entry.taskId}
                  onClick={() => setTaskDetail({ id: entry.taskId, title: entry.label, sessionId: effectiveSessionId, projectKey: projectName, runtimeId: 'pi', kind: 'task', status: entry.status })}
                  className="w-full rounded-lg border border-border/60 bg-gradient-to-r from-background via-background to-muted/20 px-2.5 py-2 text-left shadow-sm enabled:hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${entry.status === 'completed' ? 'bg-emerald-500' : ['failed', 'interrupted'].includes(entry.status || '') ? 'bg-red-500' : ['running', 'in_progress'].includes(entry.status || '') ? 'bg-blue-500 animate-pulse' : 'bg-muted-foreground/50'}`} />
                    <div className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
                      {entry.label}
                    </div>
                    {entry.detail ? (
                      <div className="max-w-[140px] flex-shrink truncate text-[10px] text-muted-foreground">
                        {entry.status ? agentStatusLabel(entry.status, i18n.language.startsWith('zh')) : entry.detail}
                      </div>
                    ) : null}
                    <div className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
                      <ItemBadge>{getTaskKindLabel(entry.kind)}</ItemBadge>
                      <ItemBadge>{formatTimeLabel(entry.lastSeenAt, i18n.language)}</ItemBadge>
                    </div>
                  </div>
                </button>
              ))
            )}
            {displaySummary.tasks.length > 6 && <button type="button" onClick={() => setShowAllTasks((value) => !value)} className="px-2 py-1 text-xs text-muted-foreground">{showAllTasks ? (i18n.language.startsWith('zh') ? '收起' : 'Show less') : (i18n.language.startsWith('zh') ? `查看全部 ${displaySummary.tasks.length} 项` : `Show all ${displaySummary.tasks.length}`)}</button>}
            {taskDetail && <AgentWorkDetails item={taskDetail} onClose={() => setTaskDetail(null)} />}
          </div>
          )}
        </section>

        <section className={`rounded-xl border p-3.5 ${SECTION_STYLES.review.panel} ${collapsedSections.review ? '' : 'flex min-h-[240px] flex-1 flex-col overflow-hidden'}`}>
          <SectionHeader
            title={t('sessionContext.sections.reviewQueue')}
            count={filteredOutputFiles.length}
            tone="review"
            icon={FileOutput}
            collapsed={collapsedSections.review}
            onToggle={() => toggleSection('review')}
            actions={!collapsedSections.review ? (
            <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/35 p-1 shadow-sm">
              {([
                { value: 'all', labelKey: 'sessionContext.filters.all' },
                { value: 'unread', labelKey: 'sessionContext.filters.unread' },
                { value: 'reviewed', labelKey: 'sessionContext.filters.reviewed' },
              ] as Array<{ value: ReviewFilter; labelKey: string }>).map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setReviewFilter(filter.value)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    reviewFilter === filter.value
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(filter.labelKey)}
                </button>
              ))}
            </div>
            ) : undefined}
          />

          {!collapsedSections.review && (
          <div className="panel-scroll-area min-h-0 space-y-2 overflow-y-auto">
            {filteredOutputFiles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                {t('sessionContext.empty.reviewQueue')}
              </div>
            ) : (
              filteredOutputFiles.slice(0, 8).map((file) => (
                <ItemButton
                  key={file.key}
                  label={file.name}
                  unread={file.unread}
                  compact
                  onClick={() => {
                    void openReviewFile(file);
                  }}
                  action={<OpenFileButton title={t('sessionContext.preview.open')} />}
                  meta={
                    <>
                      {file.reasons[0] ? <ItemBadge>{file.reasons[0]}</ItemBadge> : null}
                      <ItemBadge>{file.count}x</ItemBadge>
                      <ItemBadge>{formatTimeLabel(file.lastSeenAt, i18n.language)}</ItemBadge>
                      <ItemBadge tone={file.unread ? 'unread' : 'default'}>{file.unread ? <><EyeOff className="mr-1 h-3 w-3" />{t('sessionContext.filters.unread')}</> : <><Eye className="mr-1 h-3 w-3" />{t('sessionContext.filters.reviewed')}</>}</ItemBadge>
                    </>
                  }
                />
              ))
            )}
          </div>
          )}
        </section>
          </div>
        ) : effectiveSidebarTab === 'browser' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SimpleBrowser />
          </div>
        ) : effectiveSidebarTab === 'files' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <FileTree
              selectedProject={selectedProject}
              onFileOpen={onFileOpen}
              onStartWorkspaceQa={onStartWorkspaceQa}
              enableAutoRefresh={false}
            />
          </div>
        ) : effectiveSidebarTab === 'survey' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SurveyPage
              selectedProject={selectedProject}
              compact
              onFileOpen={onFileOpen}
              onChatFromReference={onChatFromReference}
            />
          </div>
        ) : effectiveSidebarTab === 'git' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <GitPanel
              selectedProject={selectedProject}
              isMobile={isMobile}
              onFileOpen={onFileOpen}
            />
          </div>
        ) : null}

      </aside>

      {!isMobile && (
        <aside
          data-chat-files-rail="true"
          className="medical-icon-rail relative z-30 flex h-full flex-shrink-0 flex-col items-center overflow-visible border-l border-border/50 py-2.5"
          style={{ width: SIDEBAR_ICON_RAIL_WIDTH }}
          aria-label={t('sessionContext.sidebarTabs.files')}
        >
          <button
            type="button"
            onClick={handleFixedFilesRailClick}
            title={t('sessionContext.sidebarTabs.files')}
            aria-label={t('sessionContext.sidebarTabs.files')}
            aria-expanded={!isSidebarCollapsed && effectiveSidebarTab === 'files'}
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors',
              'hover:bg-accent/80 hover:text-foreground',
              !isSidebarCollapsed && effectiveSidebarTab === 'files' && 'bg-primary/12 text-primary shadow-sm',
            )}
          >
            {!isSidebarCollapsed && effectiveSidebarTab === 'files' && (
              <span className="absolute -right-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
            )}
            <Folders className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={handleFixedBrowserRailClick}
            title={t('sessionContext.sidebarTabs.browser')}
            aria-label={t('sessionContext.sidebarTabs.browser')}
            aria-expanded={!isSidebarCollapsed && effectiveSidebarTab === 'browser'}
            className={cn(
              'relative mt-1 flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors',
              'hover:bg-accent/80 hover:text-foreground',
              !isSidebarCollapsed && effectiveSidebarTab === 'browser' && 'bg-primary/12 text-primary shadow-sm',
            )}
          >
            {!isSidebarCollapsed && effectiveSidebarTab === 'browser' && (
              <span className="absolute -right-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
            )}
            <Globe2 className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={handleFixedGitRailClick}
            title={t('sessionContext.sidebarTabs.git')}
            aria-label={t('sessionContext.sidebarTabs.git')}
            aria-expanded={!isSidebarCollapsed && effectiveSidebarTab === 'git'}
            className={cn(
              'relative mt-1 flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors',
              'hover:bg-accent/80 hover:text-foreground',
              !isSidebarCollapsed && effectiveSidebarTab === 'git' && 'bg-primary/12 text-primary shadow-sm',
            )}
          >
            {!isSidebarCollapsed && effectiveSidebarTab === 'git' && (
              <span className="absolute -right-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
            )}
            <GitBranch className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.9} />
          </button>
          <ComputeNodeSelector variant="rail" />
        </aside>
      )}
    </div>
  );
}
