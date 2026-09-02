import { BookMarked, ChevronDown, ChevronRight, Database, Download, ExternalLink, Eye, FileText, Loader2, Lock, Pencil, Plus, ScanSearch, Search, Sparkles, Tags, Trash2, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollArea } from '../../ui/scroll-area';
import ReactDOM from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';
import DocxHtmlPreview from '../../docx/DocxHtmlPreview';
import { Button } from '../../ui/button';
import DashboardStatCard from '../../ui/DashboardStatCard';
import { Input } from '../../ui/input';
import SkillsDashboard from '../../SkillsDashboard';
import PubMedDiscoveryPage from '../../../features/variableKnowledge/pubmedDiscovery/PubMedDiscoveryPage';
import type { Project, AppTab } from '../../../types/app';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import { collectSkillDirectories, type SkillNode } from '../../../utils/skillsTree';
import ProFeatureGate, { type ProFeatureKey } from '../../entitlements/ProFeatureGate';
import { CAPABILITIES, type Capability, useEntitlements } from '../../../hooks/useEntitlements';
import { isAppTabVisible } from '../../../config/appModules';
import LessonComposerDialog, {
  type LessonComposerProject,
  type LessonComposerSeed,
} from './LessonComposerDialog';

type MedLibDbItem = {
  name: string;
  summary: string;
  usagePolicy: string;
  url: string;
  localPath: string;
};

type MedLibDbSection = {
  title: string;
  lead: string;
  items: MedLibDbItem[];
};

type DatabaseBrowseItem = MedLibDbItem & {
  sectionTitle: string;
};

type MedLibraryOverview = {
  total_references: number;
  zotero_references: number;
  bibtex_references: number;
  news_references: number;
  pdf_cached_references: number;
  latest_reference_update: string | null;
  linked_references: number;
  linked_projects: number;
  stable_concepts: number;
  pending_candidates: number;
  concepts_ready: boolean;
  candidates_ready: boolean;
};

type ProjectReportPreviewItem = {
  id: string;
  projectName: string;
  displayName: string;
  title: string;
  relativePath: string;
  kbUploadRelativePath: string | null;
  createdAt: string;
};

type ProjectReportGroup = {
  projectName: string;
  displayName: string;
  latestAddedAt: string | null;
  items: ProjectReportPreviewItem[];
};

const MEMORY_ASSETS_KEY = '__formal_assets__';

let cachedSkillsOverviewCount: number | null = null;

type ProjectMemoryBrief = {
  title: string;
  coreQuestion: string | null;
  knowledgeScope: string | null;
  summary: string | null;
  startStage: string | null;
  relativePath: string;
  updatedAt: string | null;
};

type ProjectMemoryReportItem = {
  id: string;
  title: string;
  relativePath: string;
  createdAt: string;
};

type ProjectMemoryReportSummary = {
  count: number;
  latestAddedAt: string | null;
  items: ProjectMemoryReportItem[];
};

type ProjectMemoryOverview = {
  totalProjects: number;
  activeProjects: number;
  historicalProjects: number;
  totalLessons: number;
  confirmedLessons: number;
  candidateLessons: number;
  manualLessons: number;
};

type ProjectMemoryLesson = {
  id: string;
  projectId: string;
  projectName: string;
  displayName: string;
  slug: string;
  title: string;
  category: string;
  status: string;
  severity: string;
  summary: string;
  trigger: string;
  correctPattern: string;
  stageHints: string[];
  timesSeen: number;
  reuseCount: number;
  source?: 'manual' | 'auto';
  injectedCount?: number;
  lastInjectedAt?: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastVerifiedAt: string | null;
  updatedAt: string | null;
};

type ProjectMemoryProject = {
  projectId: string;
  projectName: string;
  displayName: string;
  updatedAt: string | null;
  totalLessons: number;
  confirmedLessons: number;
  candidateLessons: number;
  brief: ProjectMemoryBrief | null;
  reports: ProjectMemoryReportSummary;
  topLessons: ProjectMemoryLesson[];
};

type ProjectMemoryTemplateItem = {
  id: string;
  heading: string;
  verify: string;
  pattern: string;
};

type ProjectMemorySopStep = {
  id: string;
  order: number;
  title: string;
  instruction: string;
};

type ProjectMemoryFormalTemplateAsset = {
  id: string;
  assetType: 'template';
  title: string;
  stageKey: string | null;
  stageLabel: string | null;
  description: string | null;
  items: ProjectMemoryTemplateItem[];
  createdAt: string | null;
  updatedAt: string | null;
};

type ProjectMemoryFormalSopAsset = {
  id: string;
  assetType: 'sop';
  title: string;
  stageKey: string | null;
  stageLabel: string | null;
  description: string | null;
  steps: ProjectMemorySopStep[];
  createdAt: string | null;
  updatedAt: string | null;
};

type ProjectMemoryFormalAssets = {
  templates: ProjectMemoryFormalTemplateAsset[];
  sops: ProjectMemoryFormalSopAsset[];
};

type MemoryProjectEntry = {
  key: string;
  projectName: string;
  displayName: string;
  brief: ProjectMemoryBrief | null;
  reports: ProjectReportPreviewItem[];
  lessons: ProjectMemoryLesson[];
  updatedAt: string | null;
  fileCount: number;
};

type FormalAssetEditorState =
  | {
    mode: 'create' | 'edit';
    assetType: 'template';
    assetId: string | null;
    title: string;
    stageKey: string;
    stageLabel: string;
    description: string;
    items: ProjectMemoryTemplateItem[];
  }
  | {
    mode: 'create' | 'edit';
    assetType: 'sop';
    assetId: string | null;
    title: string;
    stageKey: string;
    stageLabel: string;
    description: string;
    steps: ProjectMemorySopStep[];
  };

function filterDbItems(raw: unknown): MedLibDbItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (x): x is MedLibDbItem =>
      Boolean(x)
      && typeof x === 'object'
      && typeof (x as MedLibDbItem).name === 'string'
      && typeof (x as MedLibDbItem).summary === 'string'
      && typeof (x as MedLibDbItem).usagePolicy === 'string'
      && typeof (x as MedLibDbItem).url === 'string'
      && typeof (x as MedLibDbItem).localPath === 'string',
  );
}

function readDbSections(t: TFunction, key: string): MedLibDbSection[] {
  const raw = t(key, { returnObjects: true });
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(
      (s): s is MedLibDbSection =>
        Boolean(s)
        && typeof s === 'object'
        && typeof (s as MedLibDbSection).title === 'string'
        && typeof (s as MedLibDbSection).lead === 'string',
    )
    .map((s) => ({
      title: s.title,
      lead: s.lead,
      items: filterDbItems((s as MedLibDbSection).items),
    }));
}

function normalizeProjectMemoryBrief(raw: unknown): ProjectMemoryBrief | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Partial<ProjectMemoryBrief>;
  if (typeof item.title !== 'string') {
    return null;
  }

  return {
    title: item.title,
    coreQuestion: typeof item.coreQuestion === 'string' ? item.coreQuestion : null,
    knowledgeScope: typeof item.knowledgeScope === 'string' ? item.knowledgeScope : null,
    summary: typeof item.summary === 'string' ? item.summary : null,
    startStage: typeof item.startStage === 'string' ? item.startStage : null,
    relativePath: typeof item.relativePath === 'string' ? item.relativePath : '.pipeline/docs/research_brief.json',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
  };
}

function filterProjectMemoryReportItems(raw: unknown): ProjectMemoryReportItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (item): item is ProjectMemoryReportItem =>
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as ProjectMemoryReportItem).id === 'string'
      && typeof (item as ProjectMemoryReportItem).title === 'string'
      && typeof (item as ProjectMemoryReportItem).relativePath === 'string'
      && typeof (item as ProjectMemoryReportItem).createdAt === 'string',
  );
}

function normalizeProjectMemoryReports(raw: unknown): ProjectMemoryReportSummary {
  if (!raw || typeof raw !== 'object') {
    return {
      count: 0,
      latestAddedAt: null,
      items: [],
    };
  }

  const item = raw as Partial<ProjectMemoryReportSummary>;
  return {
    count: typeof item.count === 'number' ? item.count : 0,
    latestAddedAt: typeof item.latestAddedAt === 'string' ? item.latestAddedAt : null,
    items: filterProjectMemoryReportItems(item.items),
  };
}

function filterProjectReportPreviewItems(raw: unknown): ProjectReportPreviewItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (item): item is ProjectReportPreviewItem =>
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as ProjectReportPreviewItem).id === 'string'
      && typeof (item as ProjectReportPreviewItem).projectName === 'string'
      && typeof (item as ProjectReportPreviewItem).relativePath === 'string'
      && typeof (item as ProjectReportPreviewItem).title === 'string',
  );
}

function filterProjectMemoryLessons(raw: unknown): ProjectMemoryLesson[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (item): item is ProjectMemoryLesson =>
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as ProjectMemoryLesson).id === 'string'
      && typeof (item as ProjectMemoryLesson).title === 'string'
      && typeof (item as ProjectMemoryLesson).displayName === 'string',
  ).map((item) => ({
    ...item,
    reuseCount: typeof item.reuseCount === 'number' ? item.reuseCount : item.timesSeen,
    source: item.source === 'manual' ? 'manual' as const : 'auto' as const,
    injectedCount: typeof item.injectedCount === 'number' ? item.injectedCount : 0,
    lastInjectedAt: typeof item.lastInjectedAt === 'string' ? item.lastInjectedAt : null,
    firstSeenAt: typeof item.firstSeenAt === 'string' ? item.firstSeenAt : null,
    lastSeenAt: typeof item.lastSeenAt === 'string' ? item.lastSeenAt : null,
    lastVerifiedAt: typeof item.lastVerifiedAt === 'string' ? item.lastVerifiedAt : item.updatedAt,
  }));
}

function filterProjectMemoryProjects(raw: unknown): ProjectMemoryProject[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (item): item is ProjectMemoryProject =>
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as ProjectMemoryProject).projectId === 'string'
      && typeof (item as ProjectMemoryProject).displayName === 'string'
      && Array.isArray((item as ProjectMemoryProject).topLessons),
  ).map((item) => ({
    ...item,
    brief: normalizeProjectMemoryBrief(item.brief),
    reports: normalizeProjectMemoryReports(item.reports),
    topLessons: filterProjectMemoryLessons(item.topLessons),
  }));
}

function filterProjectMemoryTemplateItems(raw: unknown): ProjectMemoryTemplateItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (entry): entry is ProjectMemoryTemplateItem =>
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as ProjectMemoryTemplateItem).id === 'string'
      && typeof (entry as ProjectMemoryTemplateItem).heading === 'string',
  ).map((entry) => ({
    id: entry.id,
    heading: entry.heading,
    verify: typeof entry.verify === 'string' ? entry.verify : '',
    pattern: typeof entry.pattern === 'string' ? entry.pattern : '',
  }));
}

function filterProjectMemorySopSteps(raw: unknown): ProjectMemorySopStep[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (entry): entry is ProjectMemorySopStep =>
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as ProjectMemorySopStep).id === 'string'
      && typeof (entry as ProjectMemorySopStep).instruction === 'string',
  ).map((entry, index) => ({
    id: entry.id,
    order: typeof entry.order === 'number' ? entry.order : index + 1,
    title: typeof entry.title === 'string' ? entry.title : entry.instruction,
    instruction: entry.instruction,
  }));
}

function filterProjectMemoryFormalTemplateAssets(raw: unknown): ProjectMemoryFormalTemplateAsset[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (item): item is ProjectMemoryFormalTemplateAsset =>
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as ProjectMemoryFormalTemplateAsset).id === 'string'
      && Array.isArray((item as ProjectMemoryFormalTemplateAsset).items),
  ).map((item) => ({
    ...item,
    assetType: 'template',
    stageKey: typeof item.stageKey === 'string' ? item.stageKey : null,
    stageLabel: typeof item.stageLabel === 'string' ? item.stageLabel : null,
    description: typeof item.description === 'string' ? item.description : null,
    items: filterProjectMemoryTemplateItems(item.items),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
  }));
}

function filterProjectMemoryFormalSopAssets(raw: unknown): ProjectMemoryFormalSopAsset[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (item): item is ProjectMemoryFormalSopAsset =>
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as ProjectMemoryFormalSopAsset).id === 'string'
      && Array.isArray((item as ProjectMemoryFormalSopAsset).steps),
  ).map((item) => ({
    ...item,
    assetType: 'sop',
    stageKey: typeof item.stageKey === 'string' ? item.stageKey : null,
    stageLabel: typeof item.stageLabel === 'string' ? item.stageLabel : null,
    description: typeof item.description === 'string' ? item.description : null,
    steps: filterProjectMemorySopSteps(item.steps),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
  }));
}

function normalizeProjectMemoryFormalAssets(raw: unknown): ProjectMemoryFormalAssets {
  if (!raw || typeof raw !== 'object') {
    return {
      templates: [],
      sops: [],
    };
  }

  const item = raw as Partial<ProjectMemoryFormalAssets>;
  return {
    templates: filterProjectMemoryFormalTemplateAssets(item.templates),
    sops: filterProjectMemoryFormalSopAssets(item.sops),
  };
}

function normalizeProjectMemoryOverview(raw: unknown): ProjectMemoryOverview | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Partial<ProjectMemoryOverview>;
  return {
    totalProjects: typeof item.totalProjects === 'number' ? item.totalProjects : 0,
    activeProjects: typeof item.activeProjects === 'number' ? item.activeProjects : 0,
    historicalProjects: typeof item.historicalProjects === 'number' ? item.historicalProjects : 0,
    totalLessons: typeof item.totalLessons === 'number' ? item.totalLessons : 0,
    confirmedLessons: typeof item.confirmedLessons === 'number' ? item.confirmedLessons : 0,
    candidateLessons: typeof item.candidateLessons === 'number' ? item.candidateLessons : 0,
    manualLessons: typeof item.manualLessons === 'number' ? item.manualLessons : 0,
  };
}

type TabKey = 'databases' | 'skills' | 'variableOverview' | 'variableDiscovery' | 'reports';

const TAB_KEYS: TabKey[] = ['databases', 'skills', 'variableOverview', 'variableDiscovery', 'reports'];

const TAB_KEY_TO_APP_TAB: Record<TabKey, AppTab> = {
  databases: 'medlibrary',
  skills: 'skills',
  variableOverview: 'variableOverview',
  variableDiscovery: 'variableKnowledgePubmedDiscovery',
  reports: 'memorySummary',
};

const TAB_ICONS: Record<TabKey, LucideIcon> = {
  databases: Database,
  skills: Sparkles,
  variableOverview: Tags,
  variableDiscovery: ScanSearch,
  reports: BookMarked,
};

function isMedLibraryTabBarTab(value: string | null | undefined): value is TabKey {
  return Boolean(value && (TAB_KEYS as string[]).includes(value));
}

function visibleLibraryTabKeys(): TabKey[] {
  return TAB_KEYS.filter((key) => isAppTabVisible(TAB_KEY_TO_APP_TAB[key]));
}

function resolveMedLibraryTab(tab: TabKey): TabKey {
  const requested = isMedLibraryTabBarTab(tab) ? tab : null;
  if (requested && isAppTabVisible(TAB_KEY_TO_APP_TAB[requested])) {
    return requested;
  }
  return visibleLibraryTabKeys()[0] ?? 'skills';
}

function SectionTabBar({
  activeTab,
  onSelect,
  isLocked,
}: {
  activeTab: TabKey;
  onSelect: (key: TabKey) => void;
  isLocked: (key: TabKey) => boolean;
}) {
  const { t } = useTranslation('medlibrary');

  return (
    <div className="flex w-fit max-w-full items-center gap-0.5 rounded-xl border border-primary/25 bg-primary/[0.06] p-1 md:hidden">
      {visibleLibraryTabKeys().map((key) => {
        const isActive = activeTab === key;
        const Icon = TAB_ICONS[key];
        const label = t(`tabs.${key}`);

        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            title={label}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              isActive
                ? 'bg-card text-primary shadow-sm ring-1 ring-primary/30'
                : 'text-muted-foreground hover:bg-card/65 hover:text-primary',
            )}
          >
            {isLocked(key)
              ? <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              : <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={isActive ? 2.2 : 2} />}
          </button>
        );
      })}
    </div>
  );
}

function SectionPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/45 shadow-sm backdrop-blur-[1px] dark:bg-card/45">
      <div className="px-4 py-3.5 sm:px-5 sm:py-4">
        <h3 className="text-sm font-semibold leading-tight text-foreground">{title}</h3>
        <div className="mt-0.5 text-xs leading-tight text-muted-foreground">{subtitle}</div>
      </div>
      <div className="border-t border-border/50 px-4 pb-4 pt-1 sm:px-5 sm:pb-5">{children}</div>
    </div>
  );
}

function formatConceptDate(value: string, fallback: string) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed);
}

function createEditorId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

type ReportPreviewKind = 'pdf' | 'image' | 'html' | 'markdown' | 'docx' | 'text' | 'unsupported';

function getReportPreviewKind(filename: string): ReportPreviewKind {
  const ext = (filename || '').includes('.') ? (filename.split('.').pop() || '').toLowerCase() : '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (ext === 'docx') return 'docx';
  if (['txt', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml', 'tex', 'bib', 'xml', 'log'].includes(ext)) return 'text';
  return 'unsupported';
}

function ReportPreviewItemCard({
  item,
  onOpen,
}: {
  item: ProjectReportPreviewItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation('medlibrary');

  return (
    <li
      className="group rounded-xl border border-border/50 bg-card/60 px-3 py-3 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.04]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer text-left"
          onClick={onOpen}
        >
          <p className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
            {item.title}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{item.relativePath}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              {t('reportPreview.added', {
                date: formatConceptDate(item.createdAt, t('overview.notAvailable')),
              })}
            </span>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-3"
            onClick={onOpen}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            {t('reportPreview.viewFile')}
          </Button>
        </div>
      </div>
    </li>
  );
}

function SummaryActionButton({
  label,
  onClick,
  icon: Icon,
  busy = false,
  disabled = false,
  variant = 'outline',
  className,
}: {
  label: string;
  onClick: () => void;
  icon?: typeof Loader2;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'ghost';
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={busy || disabled}
      className={cn('h-7 px-2.5 text-xs', className)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy && !disabled) {
          onClick();
        }
      }}
    >
      {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : Icon ? <Icon className="mr-1.5 h-3.5 w-3.5" /> : null}
      {label}
    </Button>
  );
}

function EmptyStateCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-background/35 px-4 py-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function MemoryFileGroup({
  title,
  countLabel,
  children,
}: {
  title: string;
  countLabel: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold tracking-tight text-foreground">{title}</h4>
        <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {countLabel}
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ProjectBriefCard({
  brief,
  title,
  emptyLabel,
  stageLabel,
}: {
  brief: ProjectMemoryBrief | null;
  title: string;
  emptyLabel: string;
  stageLabel: (value: string) => string;
}) {
  const { t } = useTranslation('medlibrary');

  return (
    <section className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/80">{title}</p>
        {brief?.updatedAt ? (
          <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t('projectMemory.labels.updated', {
              date: formatConceptDate(brief.updatedAt, t('overview.notAvailable')),
            })}
          </span>
        ) : null}
      </div>
      {brief ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium text-foreground">{brief.title}</p>
          {brief.summary ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">{brief.summary}</p>
          ) : null}
          {brief.coreQuestion ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/75">
                {t('projectMemory.labels.coreQuestion')}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{brief.coreQuestion}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {brief.knowledgeScope ? (
              <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {t('projectMemory.labels.scope', { value: brief.knowledgeScope })}
              </span>
            ) : null}
            {brief.startStage ? (
              <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {stageLabel(brief.startStage)}
              </span>
            ) : null}
          </div>
          <p className="break-all font-mono text-[11px] text-muted-foreground">{brief.relativePath}</p>
        </div>
      ) : (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  );
}

function ProjectMemoryLessonCard({
  lesson,
  statusLabel,
  projectLabel,
  updatedLabel,
  seenLabel,
  triggerLabel,
  ruleLabel,
  noRuleLabel,
  severityLabel,
  stageLabel,
  manualLabel,
  injectedLabel,
  editLabel,
  deleteLabel,
  sendLabel,
  onSend,
  onEdit,
  onDelete,
  deleting = false,
}: {
  lesson: ProjectMemoryLesson;
  statusLabel: string;
  projectLabel: string;
  updatedLabel: string;
  seenLabel: string;
  triggerLabel: string;
  ruleLabel: string;
  noRuleLabel: string;
  severityLabel: string;
  stageLabel: string | null;
  manualLabel?: string;
  injectedLabel?: string | null;
  editLabel?: string;
  deleteLabel?: string;
  sendLabel?: string;
  onSend?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const isManual = lesson.source === 'manual';

  return (
    <details className="group rounded-2xl border border-border/60 bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-4 py-4 select-none [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold tracking-tight text-foreground">{lesson.title}</h4>
            <p className="mt-1 line-clamp-1 text-[12px] leading-relaxed text-muted-foreground">
              {lesson.correctPattern || lesson.summary || noRuleLabel}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{updatedLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isManual && manualLabel ? (
            <span className="rounded-full border border-primary/30 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/80">
              {manualLabel}
            </span>
          ) : null}
          <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {statusLabel}
          </span>
          <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {severityLabel}
          </span>
        </div>
      </summary>
      <div className="border-t border-border/50 px-4 pb-4 pt-4">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {projectLabel}
          </span>
          <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {seenLabel}
          </span>
          {injectedLabel ? (
            <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {injectedLabel}
            </span>
          ) : null}
          {stageLabel ? (
            <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {stageLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-muted-foreground">
          {lesson.trigger ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/80">{triggerLabel}</p>
              <p className="mt-1">{lesson.trigger}</p>
            </div>
          ) : null}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/80">{ruleLabel}</p>
            <p className="mt-1">{lesson.correctPattern || lesson.summary || noRuleLabel}</p>
          </div>
        </div>
        {onSend || (isManual && onEdit && onDelete) ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {onSend ? (
              <SummaryActionButton
                label={sendLabel || ''}
                onClick={onSend}
                icon={Sparkles}
                variant="default"
              />
            ) : null}
            {isManual && onEdit ? (
              <SummaryActionButton label={editLabel || ''} onClick={onEdit} icon={Pencil} />
            ) : null}
            {isManual && onDelete ? (
              <SummaryActionButton
                label={deleteLabel || ''}
                onClick={onDelete}
                icon={Trash2}
                busy={deleting}
                variant="ghost"
                className="text-destructive"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function FormalAssetCard({
  asset,
  itemCountLabel,
  stepCountLabel,
  updatedLabel,
  verifyLabel,
  patternLabel,
  stepLabel,
  editLabel,
  deleteLabel,
  descriptionLabel,
  onEdit,
  onDelete,
  busy,
}: {
  asset: ProjectMemoryFormalTemplateAsset | ProjectMemoryFormalSopAsset;
  itemCountLabel: (count: number) => string;
  stepCountLabel: (count: number) => string;
  updatedLabel: (date: string | null) => string;
  verifyLabel: string;
  patternLabel: string;
  stepLabel: (order: number) => string;
  editLabel: string;
  deleteLabel: string;
  descriptionLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const isTemplate = asset.assetType === 'template';
  const countLabel = isTemplate
    ? itemCountLabel(asset.items.length)
    : stepCountLabel(asset.steps.length);

  return (
    <details className="group rounded-2xl border border-border/60 bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-4 py-4 select-none [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            isTemplate
              ? 'bg-muted text-foreground dark:bg-card dark:text-foreground'
              : 'bg-clinical-warning/10 text-clinical-warning',
          )}>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold tracking-tight text-foreground">{asset.title}</h4>
            <p className="mt-1 line-clamp-1 text-[12px] leading-relaxed text-muted-foreground">
              {asset.description || asset.stageLabel || countLabel}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {countLabel}
              </span>
              {asset.stageLabel ? (
                <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {asset.stageLabel}
                </span>
              ) : null}
              <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {updatedLabel(asset.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SummaryActionButton
            label={editLabel}
            onClick={onEdit}
            icon={Pencil}
            busy={busy}
            variant="ghost"
            className="text-muted-foreground"
          />
          <SummaryActionButton
            label={deleteLabel}
            onClick={onDelete}
            icon={Trash2}
            busy={busy}
            variant="ghost"
            className="text-destructive"
          />
        </div>
      </summary>

      <div className="border-t border-border/50 px-4 pb-4 pt-4">
        {asset.description ? (
          <div className="mb-3 rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/80">{descriptionLabel}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{asset.description}</p>
          </div>
        ) : null}

        {isTemplate ? (
          <div className="space-y-2.5">
            {asset.items.map((item) => (
              <div key={item.id} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                <p className="text-sm font-medium text-foreground">{item.heading}</p>
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/80">{verifyLabel}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.verify}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/80">{patternLabel}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.pattern}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ol className="space-y-2.5">
            {asset.steps.map((step) => (
              <li key={step.id} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {stepLabel(step.order)}
                  </span>
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{step.instruction}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

function SkillCatalogLockedPreview() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none h-full select-none overflow-hidden bg-background/95 p-5 opacity-70 blur-[7px] scale-[1.015]"
    >
      <div className="flex h-full gap-5">
        <aside className="hidden w-64 shrink-0 space-y-4 lg:block">
          <div className="h-10 rounded-xl border border-border/70 bg-muted/55" />
          {[4, 5, 3, 6].map((rows, sectionIndex) => (
            <div key={sectionIndex} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
              <div className="mb-4 h-4 w-28 rounded-full bg-foreground/20" />
              <div className="space-y-3">
                {Array.from({ length: rows }).map((_, rowIndex) => (
                  <div key={rowIndex} className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-primary/25" />
                    <div className="h-3 rounded-full bg-muted-foreground/25" style={{ width: `${48 + ((rowIndex * 13) % 42)}%` }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="h-6 w-44 rounded-full bg-foreground/25" />
              <div className="mt-2 h-3 w-72 max-w-full rounded-full bg-muted-foreground/20" />
            </div>
            <div className="h-9 w-28 rounded-xl bg-primary/20" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-border/75 bg-card p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="h-4 rounded-full bg-foreground/25" style={{ width: `${58 + ((index * 9) % 34)}%` }} />
                    <div className="mt-3 h-3 w-full rounded-full bg-muted-foreground/20" />
                    <div className="mt-2 h-3 w-4/5 rounded-full bg-muted-foreground/20" />
                  </div>
                </div>
                <div className="mt-5 flex gap-2">
                  <div className="h-6 w-16 rounded-full bg-primary/15" />
                  <div className="h-6 w-20 rounded-full bg-primary/10" />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function MedicalLibraryDashboard({
  initialTab = 'databases',
  chatTargetProject = null,
  onSendToChat,
}: {
  initialTab?: TabKey;
  chatTargetProject?: Project | null;
  onSendToChat?: (project: Project, prompt: string | ChatPromptDraft) => void;
} = {}) {
  const { t } = useTranslation('medlibrary');
  const { can } = useEntitlements();
  const canUseSkillCatalog = can(CAPABILITIES.skillCatalog);
  const canUseVariableCatalog = can(CAPABILITIES.variableCatalog);
  const canUseVariableDiscovery = can(CAPABILITIES.variableDiscovery);
  const canUseProjectMemory = can(CAPABILITIES.projectMemorySummary);
  const [overview, setOverview] = useState<MedLibraryOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [projectReportItems, setProjectReportItems] = useState<ProjectReportPreviewItem[]>([]);
  const [projectReportsLoading, setProjectReportsLoading] = useState(true);
  const [projectReportsError, setProjectReportsError] = useState<string | null>(null);
  const [projectMemoryOverview, setProjectMemoryOverview] = useState<ProjectMemoryOverview | null>(null);
  const [projectMemoryActiveProjects, setProjectMemoryActiveProjects] = useState<ProjectMemoryProject[]>([]);
  const [projectMemoryHistoricalProjects, setProjectMemoryHistoricalProjects] = useState<ProjectMemoryProject[]>([]);
  const [projectMemoryFormalAssets, setProjectMemoryFormalAssets] = useState<ProjectMemoryFormalAssets>({
    templates: [],
    sops: [],
  });
  const [projectMemoryLessons, setProjectMemoryLessons] = useState<ProjectMemoryLesson[]>([]);
  const [projectMemoryLoading, setProjectMemoryLoading] = useState(true);
  const [projectMemoryError, setProjectMemoryError] = useState<string | null>(null);
  const [projectMemoryNotice, setProjectMemoryNotice] = useState<string | null>(null);
  const [projectMemoryActionError, setProjectMemoryActionError] = useState<string | null>(null);
  const [projectMemoryAssetBusyId, setProjectMemoryAssetBusyId] = useState<string | null>(null);
  const [formalAssetEditor, setFormalAssetEditor] = useState<FormalAssetEditorState | null>(null);
  const [lessonComposerSeed, setLessonComposerSeed] = useState<LessonComposerSeed | null>(null);
  const [lessonProjects, setLessonProjects] = useState<LessonComposerProject[]>([]);
  const [lessonDeletingSlug, setLessonDeletingSlug] = useState<string | null>(null);
  const [reportPreviewNotice, setReportPreviewNotice] = useState<string | null>(null);
  const [reportPreviewError, setReportPreviewError] = useState<string | null>(null);
  const [viewingReport, setViewingReport] = useState<ProjectReportPreviewItem | null>(null);
  const [viewerBlobUrl, setViewerBlobUrl] = useState<string | null>(null);
  const [viewerDownloadBlob, setViewerDownloadBlob] = useState<Blob | null>(null);
  const [viewerTextContent, setViewerTextContent] = useState<string | null>(null);
  const [viewerDocxBuffer, setViewerDocxBuffer] = useState<ArrayBuffer | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [activeTab, setActiveTabState] = useState<TabKey>(() => resolveMedLibraryTab(initialTab));
  const [variableEmbeddedMode, setVariableEmbeddedMode] = useState<'overview' | 'discovery'>(
    () => (initialTab === 'variableDiscovery' ? 'discovery' : 'overview'),
  );
  const [memorySelection, setMemorySelection] = useState<string | null>(null);
  const [memoryProjectQuery, setMemoryProjectQuery] = useState('');
  const [skillsCount, setSkillsCount] = useState<number | null>(cachedSkillsOverviewCount);
  const [skillsCountLoading, setSkillsCountLoading] = useState(cachedSkillsOverviewCount === null);
  const [activeDatabaseSection, setActiveDatabaseSection] = useState<number | 'all'>('all');

  const setActiveTab = useCallback((nextTab: TabKey) => {
    const resolved = resolveMedLibraryTab(nextTab);
    setActiveTabState(resolved);
    setVariableEmbeddedMode(resolved === 'variableDiscovery' ? 'discovery' : 'overview');
  }, []);

  useEffect(() => {
    const resolved = resolveMedLibraryTab(initialTab);
    setActiveTabState(resolved);
    setVariableEmbeddedMode(resolved === 'variableDiscovery' ? 'discovery' : 'overview');
  }, [initialTab]);

  const handleSendSkillToChat = useCallback((command: string) => {
    if (!chatTargetProject || !onSendToChat) {
      return;
    }

    onSendToChat(chatTargetProject, command);
  }, [chatTargetProject, onSendToChat]);

  const databaseSections = useMemo(() => readDbSections(t, 'mirroredDatabases.sections'), [t]);
  const databaseCount = useMemo(
    () => databaseSections.reduce((total, section) => total + section.items.length, 0),
    [databaseSections],
  );
  const selectedDatabaseSection = useMemo(
    () => activeDatabaseSection === 'all' ? null : databaseSections[activeDatabaseSection] ?? null,
    [activeDatabaseSection, databaseSections],
  );
  const visibleDatabases = useMemo<DatabaseBrowseItem[]>(
    () => (selectedDatabaseSection ? [selectedDatabaseSection] : databaseSections).flatMap((section) => (
      section.items.map((item) => ({ ...item, sectionTitle: section.title }))
    )),
    [databaseSections, selectedDatabaseSection],
  );
  const lockedTab = useMemo<{ capability: Capability; feature: ProFeatureKey } | null>(() => {
    if (activeTab === 'variableOverview' && !canUseVariableCatalog) {
      return { capability: CAPABILITIES.variableCatalog, feature: 'variableCatalog' };
    }
    if (activeTab === 'variableDiscovery' && !canUseVariableDiscovery) {
      return { capability: CAPABILITIES.variableDiscovery, feature: 'variableDiscovery' };
    }
    if (activeTab === 'reports' && !canUseProjectMemory) {
      return { capability: CAPABILITIES.projectMemorySummary, feature: 'projectMemory' };
    }
    return null;
  }, [activeTab, canUseProjectMemory, canUseVariableCatalog, canUseVariableDiscovery]);
  const isTabLocked = useCallback((tab: TabKey) => (
    (tab === 'skills' && !canUseSkillCatalog)
    || (tab === 'variableOverview' && !canUseVariableCatalog)
    || (tab === 'variableDiscovery' && !canUseVariableDiscovery)
    || (tab === 'reports' && !canUseProjectMemory)
  ), [canUseProjectMemory, canUseSkillCatalog, canUseVariableCatalog, canUseVariableDiscovery]);

  const officialSiteLabel = t('mirroredDatabases.officialSite');
  const groupedProjectReports = useMemo<ProjectReportGroup[]>(() => {
    const groups = new Map<string, ProjectReportGroup>();

    for (const item of projectReportItems) {
      const key = item.projectName || item.displayName;
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
        if (!existing.latestAddedAt || new Date(item.createdAt).getTime() > new Date(existing.latestAddedAt).getTime()) {
          existing.latestAddedAt = item.createdAt;
        }
      } else {
        groups.set(key, {
          projectName: item.projectName,
          displayName: item.displayName,
          latestAddedAt: item.createdAt || null,
          items: [item],
        });
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: [...group.items].sort(
          (left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime(),
        ),
      }))
      .sort(
        (left, right) => new Date(right.latestAddedAt || 0).getTime() - new Date(left.latestAddedAt || 0).getTime(),
      );
  }, [projectReportItems]);
  const memoryProjects = useMemo<MemoryProjectEntry[]>(() => {
    const entries = new Map<string, MemoryProjectEntry>();

    const ensure = (projectName: string, displayName: string) => {
      const key = projectName || displayName;
      const existing = entries.get(key);
      if (existing) {
        return existing;
      }
      const created: MemoryProjectEntry = {
        key,
        projectName: projectName || displayName,
        displayName: displayName || projectName,
        brief: null,
        reports: [],
        lessons: [],
        updatedAt: null,
        fileCount: 0,
      };
      entries.set(key, created);
      return created;
    };

    const touch = (entry: MemoryProjectEntry, date: string | null) => {
      if (!date) {
        return;
      }
      if (!entry.updatedAt || new Date(date).getTime() > new Date(entry.updatedAt).getTime()) {
        entry.updatedAt = date;
      }
    };

    for (const group of groupedProjectReports) {
      const entry = ensure(group.projectName, group.displayName);
      entry.reports = group.items;
      touch(entry, group.latestAddedAt);
    }

    for (const project of [...projectMemoryActiveProjects, ...projectMemoryHistoricalProjects]) {
      const entry = ensure(project.projectName, project.displayName);
      if (project.brief) {
        entry.brief = project.brief;
      }
      entry.lessons.push(...project.topLessons);
      touch(entry, project.updatedAt);
    }

    for (const lesson of projectMemoryLessons) {
      const entry = ensure(lesson.projectName, lesson.displayName);
      entry.lessons.push(lesson);
      touch(entry, lesson.lastVerifiedAt || lesson.updatedAt);
    }

    return Array.from(entries.values())
      .map((entry) => {
        const lessons = Array.from(new Map(entry.lessons.map((lesson) => [lesson.id, lesson])).values())
          .sort((left, right) => (
            new Date((right.lastVerifiedAt || right.updatedAt) || 0).getTime()
            - new Date((left.lastVerifiedAt || left.updatedAt) || 0).getTime()
          ));

        return { ...entry, lessons, fileCount: entry.reports.length + lessons.length };
      })
      .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
  }, [groupedProjectReports, projectMemoryActiveProjects, projectMemoryHistoricalProjects, projectMemoryLessons]);

  const filteredMemoryProjects = useMemo(() => {
    const query = memoryProjectQuery.trim().toLowerCase();
    if (!query) {
      return memoryProjects;
    }
    return memoryProjects.filter((project) => (
      project.displayName.toLowerCase().includes(query)
      || project.projectName.toLowerCase().includes(query)
    ));
  }, [memoryProjects, memoryProjectQuery]);

  const selectedMemoryProject = useMemo(
    () => memoryProjects.find((project) => project.key === memorySelection) ?? null,
    [memoryProjects, memorySelection],
  );

  const memoryFormalAssetCount = projectMemoryFormalAssets.templates.length + projectMemoryFormalAssets.sops.length;
  const memoryWorkspaceLoading = projectMemoryLoading || projectReportsLoading;

  useEffect(() => {
    if (memoryWorkspaceLoading) {
      return;
    }
    if (memorySelection === MEMORY_ASSETS_KEY && memoryFormalAssetCount > 0) {
      return;
    }
    if (memorySelection && memoryProjects.some((project) => project.key === memorySelection)) {
      return;
    }
    setMemorySelection(memoryProjects[0]?.key ?? (memoryFormalAssetCount > 0 ? MEMORY_ASSETS_KEY : null));
  }, [memoryFormalAssetCount, memoryProjects, memorySelection, memoryWorkspaceLoading]);


  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);

    try {
      const res = await api.medLibrary.overview();
      if (!res.ok) {
        throw new Error('Failed to fetch overview');
      }
      const data = await res.json();
      setOverview(data.overview || null);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadProjectReports = useCallback(async () => {
    setProjectReportsLoading(true);
    setProjectReportsError(null);
    try {
      const res = await api.medLibrary.reportPreview();
      if (!res.ok) {
        throw new Error('Failed to fetch report preview');
      }
      const data = await res.json();
      setProjectReportItems(filterProjectReportPreviewItems(data.items));
    } catch (error) {
      setProjectReportsError(error instanceof Error ? error.message : 'Unknown error');
      setProjectReportItems([]);
    } finally {
      setProjectReportsLoading(false);
    }
  }, []);

  const loadProjectMemory = useCallback(async () => {
    setProjectMemoryLoading(true);
    setProjectMemoryError(null);

    try {
      const res = await api.medLibrary.projectMemory();
      if (!res.ok) {
        throw new Error('Failed to fetch project memory');
      }
      const data = await res.json();
      setProjectMemoryOverview(normalizeProjectMemoryOverview(data.overview));
      setProjectMemoryActiveProjects(filterProjectMemoryProjects(data.activeProjects));
      setProjectMemoryHistoricalProjects(filterProjectMemoryProjects(data.historicalProjects));
      setProjectMemoryFormalAssets(normalizeProjectMemoryFormalAssets(data.formalAssets));
      setProjectMemoryLessons(filterProjectMemoryLessons(data.recentLessons));
    } catch (error) {
      setProjectMemoryError(error instanceof Error ? error.message : 'Unknown error');
      setProjectMemoryOverview(null);
      setProjectMemoryActiveProjects([]);
      setProjectMemoryHistoricalProjects([]);
      setProjectMemoryFormalAssets({
        templates: [],
        sops: [],
      });
      setProjectMemoryLessons([]);
    } finally {
      setProjectMemoryLoading(false);
    }
  }, []);

  const loadLessonProjects = useCallback(async () => {
    try {
      const res = await api.projects();
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data?.projects ?? []);
      setLessonProjects(
        rows
          .filter((row: { name?: unknown }) => typeof row?.name === 'string' && row.name)
          .map((row: { name: string; displayName?: string }) => ({
            name: row.name,
            displayName: row.displayName || row.name,
          })),
      );
    } catch {
      setLessonProjects([]);
    }
  }, []);

  const openLessonComposer = useCallback((seed: LessonComposerSeed = {}) => {
    setProjectMemoryActionError(null);
    setProjectMemoryNotice(null);
    setLessonComposerSeed({
      projectName: chatTargetProject?.name ?? null,
      ...seed,
    });
  }, [chatTargetProject?.name]);

  const handleSendLessonToChat = useCallback((lesson: ProjectMemoryLesson) => {
    if (!chatTargetProject || !onSendToChat) {
      return;
    }
    const rule = lesson.correctPattern || lesson.summary || lesson.title;
    const when = lesson.trigger ? t('lessonComposer.sendToChat.when', { value: lesson.trigger }) : '';
    onSendToChat(
      chatTargetProject,
      [t('lessonComposer.sendToChat.prefix'), `- ${lesson.title}${when}: ${rule}`].join('\n'),
    );
    setProjectMemoryNotice(t('lessonComposer.sendToChat.sent', { title: lesson.title }));
  }, [chatTargetProject, onSendToChat, t]);

  const handleLessonSaved = useCallback((savedCount: number) => {
    setLessonComposerSeed(null);
    setProjectMemoryNotice(t('lessonComposer.messages.saved', { count: savedCount }));
    loadProjectMemory().catch(() => {});
  }, [loadProjectMemory, t]);

  const handleDeleteLesson = useCallback(async (lesson: ProjectMemoryLesson) => {
    if (lessonDeletingSlug) {
      return;
    }
    if (!window.confirm(t('lessonComposer.messages.confirmDelete'))) {
      return;
    }

    setLessonDeletingSlug(lesson.slug);
    setProjectMemoryActionError(null);
    setProjectMemoryNotice(null);
    try {
      const res = await api.medLibrary.deleteLesson(lesson.slug, lesson.projectName);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || t('lessonComposer.errors.deleteFailed'));
      }
      setProjectMemoryNotice(t('lessonComposer.messages.deleted'));
      await loadProjectMemory();
    } catch (error) {
      setProjectMemoryActionError(error instanceof Error ? error.message : t('lessonComposer.errors.deleteFailed'));
    } finally {
      setLessonDeletingSlug(null);
    }
  }, [lessonDeletingSlug, loadProjectMemory, t]);

  const openEditTemplateAsset = useCallback((asset: ProjectMemoryFormalTemplateAsset) => {
    setFormalAssetEditor({
      mode: 'edit',
      assetType: 'template',
      assetId: asset.id,
      title: asset.title,
      stageKey: asset.stageKey || '',
      stageLabel: asset.stageLabel || '',
      description: asset.description || '',
      items: asset.items.map((item, index) => ({
        ...item,
        id: item.id || `template-item-${index + 1}`,
      })),
    });
  }, []);

  const openEditSopAsset = useCallback((asset: ProjectMemoryFormalSopAsset) => {
    setFormalAssetEditor({
      mode: 'edit',
      assetType: 'sop',
      assetId: asset.id,
      title: asset.title,
      stageKey: asset.stageKey || '',
      stageLabel: asset.stageLabel || '',
      description: asset.description || '',
      steps: asset.steps.map((step, index) => ({
        ...step,
        id: step.id || `sop-step-${index + 1}`,
        order: typeof step.order === 'number' ? step.order : index + 1,
      })),
    });
  }, []);

  const openCreateTemplateAsset = useCallback(() => {
    setFormalAssetEditor({
      mode: 'create',
      assetType: 'template',
      assetId: null,
      title: '',
      stageKey: '',
      stageLabel: '',
      description: '',
      items: [
        {
          id: createEditorId('template-item'),
          heading: '',
          verify: '',
          pattern: '',
        },
      ],
    });
  }, []);

  const openCreateSopAsset = useCallback(() => {
    setFormalAssetEditor({
      mode: 'create',
      assetType: 'sop',
      assetId: null,
      title: '',
      stageKey: '',
      stageLabel: '',
      description: '',
      steps: [
        {
          id: createEditorId('sop-step'),
          order: 1,
          title: '',
          instruction: '',
        },
      ],
    });
  }, []);

  const updateFormalAssetEditorField = useCallback((
    field: 'title' | 'stageKey' | 'stageLabel' | 'description',
    value: string,
  ) => {
    setFormalAssetEditor((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  }, []);

  const updateTemplateEditorItem = useCallback((
    itemId: string,
    field: 'heading' | 'verify' | 'pattern',
    value: string,
  ) => {
    setFormalAssetEditor((prev) => {
      if (!prev || prev.assetType !== 'template') {
        return prev;
      }
      return {
        ...prev,
        items: prev.items.map((item) => (
          item.id === itemId
            ? {
              ...item,
              [field]: value,
            }
            : item
        )),
      };
    });
  }, []);

  const addTemplateEditorItem = useCallback(() => {
    setFormalAssetEditor((prev) => {
      if (!prev || prev.assetType !== 'template') {
        return prev;
      }
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            id: createEditorId('template-item'),
            heading: '',
            verify: '',
            pattern: '',
          },
        ],
      };
    });
  }, []);

  const removeTemplateEditorItem = useCallback((itemId: string) => {
    setFormalAssetEditor((prev) => {
      if (!prev || prev.assetType !== 'template') {
        return prev;
      }
      const nextItems = prev.items.filter((item) => item.id !== itemId);
      return {
        ...prev,
        items: nextItems.length > 0 ? nextItems : prev.items,
      };
    });
  }, []);

  const updateSopEditorStep = useCallback((
    stepId: string,
    field: 'title' | 'instruction',
    value: string,
  ) => {
    setFormalAssetEditor((prev) => {
      if (!prev || prev.assetType !== 'sop') {
        return prev;
      }
      return {
        ...prev,
        steps: prev.steps.map((step) => (
          step.id === stepId
            ? {
              ...step,
              [field]: value,
            }
            : step
        )),
      };
    });
  }, []);

  const addSopEditorStep = useCallback(() => {
    setFormalAssetEditor((prev) => {
      if (!prev || prev.assetType !== 'sop') {
        return prev;
      }
      return {
        ...prev,
        steps: [
          ...prev.steps,
          {
            id: createEditorId('sop-step'),
            order: prev.steps.length + 1,
            title: '',
            instruction: '',
          },
        ],
      };
    });
  }, []);

  const removeSopEditorStep = useCallback((stepId: string) => {
    setFormalAssetEditor((prev) => {
      if (!prev || prev.assetType !== 'sop') {
        return prev;
      }
      const nextSteps = prev.steps
        .filter((step) => step.id !== stepId)
        .map((step, index) => ({
          ...step,
          order: index + 1,
        }));
      return {
        ...prev,
        steps: nextSteps.length > 0 ? nextSteps : prev.steps,
      };
    });
  }, []);

  const handleSaveFormalAsset = useCallback(async () => {
    if (!formalAssetEditor) {
      return;
    }

    const normalizedTitle = formalAssetEditor.title.trim();
    if (!normalizedTitle) {
      setProjectMemoryActionError(t('projectMemory.messages.assetTitleRequired'));
      return;
    }

    if (formalAssetEditor.assetType === 'template') {
      const hasContent = formalAssetEditor.items.some((item) => (
        item.heading.trim() || item.verify.trim() || item.pattern.trim()
      ));
      if (!hasContent) {
        setProjectMemoryActionError(t('projectMemory.messages.assetTemplateRequired'));
        return;
      }
    }

    if (formalAssetEditor.assetType === 'sop') {
      const hasContent = formalAssetEditor.steps.some((step) => (
        step.title.trim() || step.instruction.trim()
      ));
      if (!hasContent) {
        setProjectMemoryActionError(t('projectMemory.messages.assetSopRequired'));
        return;
      }
    }

    setProjectMemoryAssetBusyId(formalAssetEditor.assetId || `${formalAssetEditor.assetType}:new`);
    setProjectMemoryActionError(null);
    setProjectMemoryNotice(null);

    try {
      const body = formalAssetEditor.assetType === 'template'
        ? {
          assetType: 'template',
          title: normalizedTitle,
          stageKey: formalAssetEditor.stageKey,
          stageLabel: formalAssetEditor.stageLabel,
          description: formalAssetEditor.description,
          items: formalAssetEditor.items,
        }
        : {
          assetType: 'sop',
          title: normalizedTitle,
          stageKey: formalAssetEditor.stageKey,
          stageLabel: formalAssetEditor.stageLabel,
          description: formalAssetEditor.description,
          steps: formalAssetEditor.steps,
        };

      const res = formalAssetEditor.mode === 'edit' && formalAssetEditor.assetId
        ? await api.medLibrary.updateOperatingAsset(formalAssetEditor.assetId, body)
        : await api.medLibrary.createOperatingAsset(body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t('projectMemory.messages.assetSaveError'));
      }

      setProjectMemoryNotice(t(
        formalAssetEditor.mode === 'edit'
          ? 'projectMemory.messages.assetUpdated'
          : 'projectMemory.messages.assetCreated',
      ));
      setFormalAssetEditor(null);
      await loadProjectMemory();
    } catch (error) {
      setProjectMemoryActionError(error instanceof Error ? error.message : t('projectMemory.messages.assetSaveError'));
    } finally {
      setProjectMemoryAssetBusyId(null);
    }
  }, [formalAssetEditor, loadProjectMemory, t]);

  const handleDeleteFormalAsset = useCallback(async (id: string) => {
    if (!window.confirm(t('projectMemory.messages.assetDeleteConfirm'))) {
      return;
    }

    setProjectMemoryAssetBusyId(id);
    setProjectMemoryActionError(null);
    setProjectMemoryNotice(null);
    try {
      const res = await api.medLibrary.deleteOperatingAsset(id);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t('projectMemory.messages.assetDeleteError'));
      }
      setProjectMemoryNotice(t('projectMemory.messages.assetDeleted'));
      await loadProjectMemory();
    } catch (error) {
      setProjectMemoryActionError(error instanceof Error ? error.message : t('projectMemory.messages.assetDeleteError'));
    } finally {
      setProjectMemoryAssetBusyId(null);
    }
  }, [loadProjectMemory, t]);

  const loadSkillsCount = useCallback(async () => {
    if (cachedSkillsOverviewCount === null) {
      setSkillsCountLoading(true);
    }
    try {
      const response = await api.getGlobalSkills();
      if (response.ok) {
        const treeNodes = (await response.json()) as SkillNode[];
        const count = collectSkillDirectories(treeNodes).length;
        cachedSkillsOverviewCount = count;
        setSkillsCount(count);
        return;
      }
      if (response.status === 404) {
        cachedSkillsOverviewCount = 0;
        setSkillsCount(0);
        return;
      }
      if (cachedSkillsOverviewCount === null) {
        setSkillsCount(null);
      }
    } catch {
      if (cachedSkillsOverviewCount === null) {
        setSkillsCount(null);
      }
    } finally {
      setSkillsCountLoading(false);
    }
  }, []);

  const handleSkillsCountChange = useCallback((count: number) => {
    cachedSkillsOverviewCount = count;
    setSkillsCount(count);
    setSkillsCountLoading(false);
  }, []);

  useEffect(() => {
    loadOverview().catch(() => {});
    if (canUseProjectMemory) {
      loadProjectMemory().catch(() => {});
      loadProjectReports().catch(() => {});
    }
    if (canUseSkillCatalog) {
      loadSkillsCount().catch(() => {});
    } else {
      setSkillsCount(null);
      setSkillsCountLoading(false);
    }
  }, [canUseProjectMemory, canUseSkillCatalog, loadOverview, loadProjectMemory, loadProjectReports, loadSkillsCount]);

  useEffect(() => {
    if (activeTab === 'reports' && canUseProjectMemory) {
      loadProjectReports().catch(() => {});
      loadProjectMemory().catch(() => {});
      loadLessonProjects().catch(() => {});
      return;
    }
  }, [activeTab, canUseProjectMemory, loadLessonProjects, loadProjectMemory, loadProjectReports]);

  const closeReportViewer = useCallback(() => {
    setViewingReport(null);
    setViewerError(null);
    setViewerTextContent(null);
    setViewerDocxBuffer(null);
    setViewerDownloadBlob(null);
    if (viewerBlobUrl) {
      URL.revokeObjectURL(viewerBlobUrl);
    }
    setViewerBlobUrl(null);
  }, [viewerBlobUrl]);

  const openReportViewer = useCallback(async (item: ProjectReportPreviewItem) => {
    closeReportViewer();
    setViewingReport(item);
    setViewerLoading(true);
    setViewerError(null);

    const kind = getReportPreviewKind(item.relativePath || item.title);
    const needsBlob = kind === 'pdf' || kind === 'image' || kind === 'docx';

    try {
      const blob = await api.medLibrary.reportPreviewContent(item.id);
      setViewerDownloadBlob(blob);
      if (needsBlob) {
        const url = URL.createObjectURL(blob);
        setViewerBlobUrl(url);
        if (kind === 'docx') {
          setViewerDocxBuffer(await blob.arrayBuffer());
        }
      } else if (kind !== 'unsupported') {
        const text = await blob.text();
        setViewerTextContent(text);
      }
    } catch (err) {
      setViewerError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setViewerLoading(false);
    }
  }, [closeReportViewer]);

  const handleViewerDownload = useCallback(async () => {
    if (!viewingReport) return;
    try {
      const blob = viewerDownloadBlob || await api.medLibrary.reportPreviewContent(viewingReport.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = viewingReport.title || 'report';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* ignore download error */ }
  }, [viewerDownloadBlob, viewingReport]);

  const formalAssetEditorBusy = formalAssetEditor
    ? projectMemoryAssetBusyId === (formalAssetEditor.assetId || `${formalAssetEditor.assetType}:new`)
    : false;
  const formalAssetEditorTitle = formalAssetEditor
    ? t(
      formalAssetEditor.assetType === 'template'
        ? formalAssetEditor.mode === 'edit'
          ? 'projectMemory.editor.editTemplateTitle'
          : 'projectMemory.editor.createTemplateTitle'
        : formalAssetEditor.mode === 'edit'
          ? 'projectMemory.editor.editSopTitle'
          : 'projectMemory.editor.createSopTitle',
    )
    : '';
  const formalAssetEditorLead = formalAssetEditor
    ? t(
      formalAssetEditor.assetType === 'template'
        ? 'projectMemory.editor.templateLead'
        : 'projectMemory.editor.sopLead',
    )
    : '';

  const renderLessonCard = (lesson: ProjectMemoryLesson) => (
    <ProjectMemoryLessonCard
      key={lesson.id}
      lesson={lesson}
      statusLabel={t(`projectMemory.labels.${lesson.status === 'confirmed' ? 'confirmed' : 'candidate'}`)}
      projectLabel={t('projectMemory.labels.project', { value: lesson.displayName })}
      updatedLabel={t('projectMemory.labels.lastVerified', {
        date: formatConceptDate((lesson.lastVerifiedAt || lesson.updatedAt) || '', t('overview.notAvailable')),
      })}
      seenLabel={t('projectMemory.labels.reuseCount', { count: lesson.reuseCount })}
      triggerLabel={t('projectMemory.labels.trigger')}
      ruleLabel={t('projectMemory.labels.rule')}
      noRuleLabel={t('projectMemory.labels.noRule')}
      severityLabel={t(`projectMemory.labels.${lesson.severity === 'high' ? 'severityHigh' : lesson.severity === 'medium' ? 'severityMedium' : 'severityLow'}`)}
      stageLabel={lesson.stageHints[0] ? t('projectMemory.labels.stage', { value: lesson.stageHints[0] }) : null}
      manualLabel={t('lessonComposer.labels.manual')}
      injectedLabel={lesson.injectedCount
        ? t('lessonComposer.labels.injectedCount', { count: lesson.injectedCount })
        : null}
      sendLabel={t('lessonComposer.sendToChat.action')}
      onSend={chatTargetProject && onSendToChat ? () => handleSendLessonToChat(lesson) : undefined}
      editLabel={t('lessonComposer.actions.edit')}
      deleteLabel={t('lessonComposer.actions.delete')}
      deleting={lessonDeletingSlug === lesson.slug}
      onEdit={() => openLessonComposer({
        projectName: lesson.projectName,
        slug: lesson.slug,
        title: lesson.title,
        trigger: lesson.trigger,
        correctPattern: lesson.correctPattern || lesson.summary,
        severity: lesson.severity,
        stageHints: lesson.stageHints,
      })}
      onDelete={() => { handleDeleteLesson(lesson).catch(() => {}); }}
    />
  );

  const memoryActionBanner = (
    <>
      {projectReportsError ? (
        <div className="rounded-xl border border-clinical-warning/35 bg-clinical-warning/10 px-3 py-2 text-sm text-clinical-warning">
          {t('reportPreview.fetchFailed')}
        </div>
      ) : null}
      {projectMemoryError ? (
        <div className="rounded-xl border border-clinical-warning/35 bg-clinical-warning/10 px-3 py-2 text-sm text-clinical-warning">
          {t('projectMemory.fetchFailed')}
        </div>
      ) : null}
      {reportPreviewError || projectMemoryActionError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {reportPreviewError || projectMemoryActionError}
        </div>
      ) : null}
      {reportPreviewNotice || projectMemoryNotice ? (
        <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm text-foreground">
          {reportPreviewNotice || projectMemoryNotice}
        </div>
      ) : null}
    </>
  );

  const isSkillsWorkspace = activeTab === 'skills';

  return (
    <div className={cn(
      'h-full bg-background',
      isSkillsWorkspace ? 'flex min-h-0 flex-col overflow-hidden' : 'panel-scroll-area overflow-y-auto',
    )}>
      <div className={cn(
        'mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4 sm:p-6',
        isSkillsWorkspace && 'h-full min-h-0 pb-2 sm:pb-2',
      )}>
        {visibleLibraryTabKeys().length > 0 ? (
          <SectionTabBar
            activeTab={activeTab}
            onSelect={setActiveTab}
            isLocked={isTabLocked}
          />
        ) : null}

        {overviewError ? (
          <div className="rounded-2xl border border-clinical-warning/35 bg-clinical-warning/10 px-4 py-3 text-sm leading-relaxed text-clinical-warning">
            {t('overview.fetchFailed')}
          </div>
        ) : null}

        {lockedTab ? (
          <div className="min-h-[420px] overflow-hidden rounded-2xl border border-border/50">
            <ProFeatureGate capability={lockedTab.capability} feature={lockedTab.feature}>
              <div />
            </ProFeatureGate>
          </div>
        ) : null}

        {!lockedTab && (activeTab === 'variableOverview' || activeTab === 'variableDiscovery') && (
          <SectionPanel
            title={t(activeTab === 'variableOverview'
              ? 'variableKnowledge.overviewTitle'
              : 'variableKnowledge.discoveryTitle')}
            subtitle={t(activeTab === 'variableOverview'
              ? 'variableKnowledge.overviewLead'
              : 'variableKnowledge.discoveryLead')}
          >
            <PubMedDiscoveryPage
              embedded
              embeddedMode={variableEmbeddedMode}
              chatTargetProject={chatTargetProject}
              onSendVariableToChat={onSendToChat}
            />
          </SectionPanel>
        )}

        {!lockedTab && activeTab === 'reports' && (
          <SectionPanel
            title={t('memoryWorkspace.title')}
            subtitle={t('memoryWorkspace.lead')}
          >
            <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-border/70 bg-card/95 lg:h-[min(calc(100vh-14rem),900px)] lg:grid-cols-[280px_minmax(0,1fr)] lg:divide-x lg:divide-border/70 2xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 space-y-3 border-b border-border/70 px-4 py-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                      {t('memoryWorkspace.directoryEyebrow')}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-foreground">{t('memoryWorkspace.directoryTitle')}</h3>
                      <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {t('memoryWorkspace.projectCount', { count: memoryProjects.length })}
                      </span>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={memoryProjectQuery}
                      onChange={(event) => setMemoryProjectQuery(event.target.value)}
                      placeholder={t('memoryWorkspace.searchPlaceholder')}
                      className="h-8 w-full rounded-lg border border-border/60 bg-background pl-8 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                    />
                  </div>
                </div>
                <ScrollArea className="panel-scroll-area sidebar-scroll-area min-h-0 flex-1">
                  <div className="space-y-1 p-3">
                    {memoryFormalAssetCount > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setMemorySelection(MEMORY_ASSETS_KEY)}
                          aria-label={t('memoryWorkspace.selectAria', { title: t('memoryWorkspace.assetsEntry') })}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
                            memorySelection === MEMORY_ASSETS_KEY
                              ? 'bg-muted/70 text-foreground'
                              : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground',
                          )}
                        >
                          <span className="min-w-0 flex items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 truncate text-sm font-semibold">{t('memoryWorkspace.assetsEntry')}</span>
                          </span>
                          <span className="shrink-0 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {memoryFormalAssetCount}
                          </span>
                        </button>
                      </>
                    ) : null}
                    <div className="!my-2 border-t border-border/60" />

                    {filteredMemoryProjects.length === 0 ? (
                      <p className="px-3 py-6 text-xs leading-relaxed text-muted-foreground">
                        {memoryWorkspaceLoading
                          ? t('projectMemory.loading')
                          : memoryProjects.length === 0
                            ? t('memoryWorkspace.empty')
                            : t('memoryWorkspace.searchEmpty')}
                      </p>
                    ) : filteredMemoryProjects.map((project) => (
                      <button
                        key={project.key}
                        type="button"
                        onClick={() => setMemorySelection(project.key)}
                        aria-label={t('memoryWorkspace.selectAria', { title: project.displayName })}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
                          memorySelection === project.key
                            ? 'bg-muted/70 text-foreground'
                            : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{project.displayName}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {t('memoryWorkspace.updatedAt', {
                              date: formatConceptDate(project.updatedAt || '', t('overview.notAvailable')),
                            })}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {project.fileCount}
                        </span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </aside>

              <section className="panel-scroll-area min-h-0 min-w-0 overflow-y-auto">
                {memorySelection === MEMORY_ASSETS_KEY ? (
                  <>
                    <div className="border-b border-border/70 p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                        {t('memoryWorkspace.directoryTitle')}
                      </p>
                      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                        <h3 className="min-w-0 break-words text-xl font-semibold leading-tight text-foreground">
                          {t('memoryWorkspace.assetsEntry')}
                        </h3>
                        <div className="flex shrink-0 items-center gap-2">
                          <SummaryActionButton
                            label={t('projectMemory.actions.newTemplate')}
                            onClick={openCreateTemplateAsset}
                            icon={Plus}
                          />
                          <SummaryActionButton
                            label={t('projectMemory.actions.newSop')}
                            onClick={openCreateSopAsset}
                            icon={Plus}
                          />
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('memoryWorkspace.assetsLead')}</p>
                    </div>
                    <div className="space-y-5 p-5">
                      {memoryActionBanner}
                      <MemoryFileGroup
                        title={t('projectMemory.sections.formalTemplates.title')}
                        countLabel={t('projectMemory.labels.templateCount', { count: projectMemoryFormalAssets.templates.length })}
                      >
                        {projectMemoryFormalAssets.templates.length === 0 ? (
                          <EmptyStateCard>{t('projectMemory.sections.formalTemplates.empty')}</EmptyStateCard>
                        ) : (
                          <div className="grid gap-3 2xl:grid-cols-2">
                            {projectMemoryFormalAssets.templates.map((asset) => (
                              <FormalAssetCard
                                key={asset.id}
                                asset={asset}
                                itemCountLabel={(count) => t('projectMemory.labels.itemCount', { count })}
                                stepCountLabel={(count) => t('projectMemory.labels.stepCount', { count })}
                                updatedLabel={(date) => t('projectMemory.labels.updated', {
                                  date: formatConceptDate(date || '', t('overview.notAvailable')),
                                })}
                                verifyLabel={t('projectMemory.labels.templateVerify')}
                                patternLabel={t('projectMemory.labels.templatePattern')}
                                stepLabel={(order) => t('projectMemory.labels.step', { count: order })}
                                editLabel={t('projectMemory.actions.editAsset')}
                                deleteLabel={t('projectMemory.actions.deleteAsset')}
                                descriptionLabel={t('projectMemory.labels.description')}
                                onEdit={() => openEditTemplateAsset(asset)}
                                onDelete={() => { handleDeleteFormalAsset(asset.id).catch(() => {}); }}
                                busy={projectMemoryAssetBusyId === asset.id}
                              />
                            ))}
                          </div>
                        )}
                      </MemoryFileGroup>

                      <MemoryFileGroup
                        title={t('projectMemory.sections.formalSops.title')}
                        countLabel={t('projectMemory.labels.sopCount', { count: projectMemoryFormalAssets.sops.length })}
                      >
                        {projectMemoryFormalAssets.sops.length === 0 ? (
                          <EmptyStateCard>{t('projectMemory.sections.formalSops.empty')}</EmptyStateCard>
                        ) : (
                          <div className="grid gap-3 2xl:grid-cols-2">
                            {projectMemoryFormalAssets.sops.map((asset) => (
                              <FormalAssetCard
                                key={asset.id}
                                asset={asset}
                                itemCountLabel={(count) => t('projectMemory.labels.itemCount', { count })}
                                stepCountLabel={(count) => t('projectMemory.labels.stepCount', { count })}
                                updatedLabel={(date) => t('projectMemory.labels.updated', {
                                  date: formatConceptDate(date || '', t('overview.notAvailable')),
                                })}
                                verifyLabel={t('projectMemory.labels.templateVerify')}
                                patternLabel={t('projectMemory.labels.templatePattern')}
                                stepLabel={(order) => t('projectMemory.labels.step', { count: order })}
                                editLabel={t('projectMemory.actions.editAsset')}
                                deleteLabel={t('projectMemory.actions.deleteAsset')}
                                descriptionLabel={t('projectMemory.labels.description')}
                                onEdit={() => openEditSopAsset(asset)}
                                onDelete={() => { handleDeleteFormalAsset(asset.id).catch(() => {}); }}
                                busy={projectMemoryAssetBusyId === asset.id}
                              />
                            ))}
                          </div>
                        )}
                      </MemoryFileGroup>
                    </div>
                  </>
                ) : selectedMemoryProject ? (
                  <>
                    <div className="border-b border-border/70 p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                        {t('memoryWorkspace.directoryEyebrow')}
                      </p>
                      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                        <h3 className="min-w-0 break-words text-xl font-semibold leading-tight text-foreground">
                          {selectedMemoryProject.displayName}
                        </h3>
                        <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                          {t('memoryWorkspace.fileCount', { count: selectedMemoryProject.fileCount })}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {t('memoryWorkspace.updatedAt', {
                          date: formatConceptDate(selectedMemoryProject.updatedAt || '', t('overview.notAvailable')),
                        })}
                      </p>
                    </div>

                    <div className="space-y-5 p-5">
                      {memoryActionBanner}

                      <ProjectBriefCard
                        brief={selectedMemoryProject.brief}
                        title={t('memoryWorkspace.briefTitle')}
                        emptyLabel={t('memoryWorkspace.noBrief')}
                        stageLabel={(value) => t('projectMemory.labels.stage', { value })}
                      />

                      <MemoryFileGroup
                        title={t('memoryWorkspace.reportsTitle')}
                        countLabel={t('memoryWorkspace.fileCount', { count: selectedMemoryProject.reports.length })}
                      >
                        {selectedMemoryProject.reports.length === 0 ? (
                          <EmptyStateCard>{t('memoryWorkspace.reportsEmpty')}</EmptyStateCard>
                        ) : (
                          <ul className="space-y-2">
                            {selectedMemoryProject.reports.map((item) => (
                              <ReportPreviewItemCard
                                key={item.id}
                                item={item}
                                onOpen={() => { openReportViewer(item).catch(() => {}); }}
                              />
                            ))}
                          </ul>
                        )}
                      </MemoryFileGroup>

                      <MemoryFileGroup
                        title={t('memoryWorkspace.lessonsTitle')}
                        countLabel={t('projectMemory.labels.lessonCount', { count: selectedMemoryProject.lessons.length })}
                      >
                        {selectedMemoryProject.lessons.length === 0 ? (
                          <EmptyStateCard>{t('memoryWorkspace.lessonsEmpty')}</EmptyStateCard>
                        ) : (
                          <div className="grid gap-3 2xl:grid-cols-2">
                            {selectedMemoryProject.lessons.map(renderLessonCard)}
                          </div>
                        )}
                      </MemoryFileGroup>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full min-h-[320px] items-center justify-center p-8">
                    <p className="max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
                      {memoryWorkspaceLoading ? t('projectMemory.loading') : t('memoryWorkspace.empty')}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </SectionPanel>
        )}

        {activeTab === 'databases' && (
          <SectionPanel
            title={t('mirroredDatabases.title')}
            subtitle={t('mirroredDatabases.lead', { count: databaseCount })}
          >
            {databaseSections.length > 0 ? (
              <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-border/70 bg-card/95 lg:h-[min(calc(100vh-14rem),900px)] lg:grid-cols-[280px_minmax(0,1fr)] lg:divide-x lg:divide-border/70">
                <aside className="flex min-h-0 flex-col overflow-hidden">
                  <div className="shrink-0 border-b border-border/70 px-4 py-4">
                    <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                      {t('mirroredDatabases.directoryEyebrow')}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-foreground">{t('mirroredDatabases.browserTitle')}</h3>
                      <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {t('mirroredDatabases.categoryCount', { count: databaseCount })}
                      </span>
                    </div>
                  </div>

                  <ScrollArea className="panel-scroll-area sidebar-scroll-area min-h-0 flex-1">
                    <div className="space-y-2 p-3">
                      <button
                        type="button"
                        onClick={() => setActiveDatabaseSection('all')}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                          activeDatabaseSection === 'all'
                            ? 'border-border bg-muted/70 font-semibold text-foreground'
                            : 'border-border/70 bg-background text-foreground hover:bg-muted/60',
                        )}
                      >
                        <span>{t('mirroredDatabases.allCategories')}</span>
                        <span className="text-xs text-muted-foreground">{databaseCount}</span>
                      </button>

                      {databaseSections.map((section, sectionIndex) => (
                        <button
                          key={section.title}
                          type="button"
                          onClick={() => setActiveDatabaseSection(sectionIndex)}
                          aria-label={t('mirroredDatabases.selectCategoryAria', { title: section.title })}
                          className={cn(
                            'flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                            activeDatabaseSection === sectionIndex
                              ? 'border-border bg-muted/70 font-semibold text-foreground'
                              : 'border-border/70 bg-background text-foreground hover:bg-muted/60',
                          )}
                        >
                          <span className="min-w-0 leading-snug">{section.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{section.items.length}</span>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                  <div className="shrink-0 border-b border-border/70 p-5">
                    <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                      {t('mirroredDatabases.results')}
                    </p>
                    <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words text-xl font-semibold leading-tight text-foreground">
                          {selectedDatabaseSection?.title ?? t('mirroredDatabases.allCategories')}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {selectedDatabaseSection?.lead ?? t('mirroredDatabases.lead', { count: databaseCount })}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {t('mirroredDatabases.resultsSummary', { shown: visibleDatabases.length })}
                      </span>
                    </div>
                  </div>

                  <div className="panel-scroll-area min-h-0 flex-1 overflow-y-auto divide-y divide-border/60">
                    {visibleDatabases.map((item) => (
                      <article
                        key={`${item.sectionTitle}:${item.name}`}
                        className="px-5 py-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/40"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="break-words text-sm font-semibold text-foreground">{item.name}</h4>
                              <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-200">
                                {item.sectionTitle}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {t('mirroredDatabases.routeLabel')}: {item.localPath}
                              </span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.summary}</p>
                          </div>

                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {officialSiteLabel}
                          </a>
                        </div>

                        <details className="group mt-4 rounded-xl border border-border/60 bg-muted/20 px-3 py-3">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                            <span className="inline-flex items-center gap-2">
                              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                              {t('mirroredDatabases.usagePolicyLabel')}
                            </span>
                            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                          </summary>
                          <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.usagePolicy}</p>
                        </details>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
          </SectionPanel>
        )}

        {activeTab === 'skills' && (
          <div className="min-h-0 flex-1 overflow-hidden">
            {canUseSkillCatalog ? (
              <SkillsDashboard
                embedded
                projectName={chatTargetProject?.name ?? null}
                onSendToChat={chatTargetProject && onSendToChat ? handleSendSkillToChat : undefined}
                onSkillsCountChange={handleSkillsCountChange}
              />
            ) : (
              <div className="relative h-full min-h-0 overflow-hidden rounded-2xl border border-border/70">
                <SkillCatalogLockedPreview />
                <ProFeatureGate
                  capability={CAPABILITIES.skillCatalog}
                  feature="skillCatalog"
                  className="absolute inset-0 z-10 bg-background/20"
                  compact
                  overlay
                >
                  <div />
                </ProFeatureGate>
              </div>
            )}
          </div>
        )}

        {!isSkillsWorkspace ? (
          <p className="shrink-0 text-center text-xs leading-relaxed text-muted-foreground">{t(`footnote.${activeTab}`)}</p>
        ) : null}
      </div>
      {lessonComposerSeed ? (
        <LessonComposerDialog
          seed={lessonComposerSeed}
          projects={lessonProjects}
          onClose={() => setLessonComposerSeed(null)}
          onSaved={handleLessonSaved}
        />
      ) : null}
      {formalAssetEditor ? ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[115] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm md:p-6"
          onClick={() => setFormalAssetEditor(null)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-border/70 bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-gradient-to-r from-zinc-50 via-white to-zinc-100 px-5 py-4 dark:from-black dark:via-neutral-950 dark:to-black">
              <div className="min-w-0">
                <h3 className="text-base font-semibold tracking-tight text-foreground">{formalAssetEditorTitle}</h3>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{formalAssetEditorLead}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setFormalAssetEditor(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="panel-scroll-area flex-1 overflow-y-auto px-5 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                    {t('projectMemory.fields.title')}
                  </label>
                  <Input
                    value={formalAssetEditor.title}
                    onChange={(event) => updateFormalAssetEditorField('title', event.target.value)}
                    placeholder={t('projectMemory.fields.titlePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                    {t('projectMemory.fields.stageLabel')}
                  </label>
                  <Input
                    value={formalAssetEditor.stageLabel}
                    onChange={(event) => updateFormalAssetEditorField('stageLabel', event.target.value)}
                    placeholder={t('projectMemory.fields.stageLabelPlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                    {t('projectMemory.fields.stageKey')}
                  </label>
                  <Input
                    value={formalAssetEditor.stageKey}
                    onChange={(event) => updateFormalAssetEditorField('stageKey', event.target.value)}
                    placeholder={t('projectMemory.fields.stageKeyPlaceholder')}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                    {t('projectMemory.fields.description')}
                  </label>
                  <textarea
                    value={formalAssetEditor.description}
                    onChange={(event) => updateFormalAssetEditorField('description', event.target.value)}
                    placeholder={t('projectMemory.fields.descriptionPlaceholder')}
                    className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              </div>

              {formalAssetEditor.assetType === 'template' ? (
                <div className="mt-6 rounded-2xl border border-border/60 bg-muted/15 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold tracking-tight text-foreground">{t('projectMemory.editor.templateItemsTitle')}</h4>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('projectMemory.editor.templateItemsLead')}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={addTemplateEditorItem}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      {t('projectMemory.actions.addItem')}
                    </Button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {formalAssetEditor.items.map((item, index) => (
                      <div key={item.id} className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {t('projectMemory.labels.itemIndex', { count: index + 1 })}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive"
                            onClick={() => removeTemplateEditorItem(item.id)}
                            disabled={formalAssetEditor.items.length <= 1}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            {t('projectMemory.actions.removeItem')}
                          </Button>
                        </div>
                        <div className="mt-3 grid gap-3">
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                              {t('projectMemory.fields.itemHeading')}
                            </label>
                            <Input
                              value={item.heading}
                              onChange={(event) => updateTemplateEditorItem(item.id, 'heading', event.target.value)}
                              placeholder={t('projectMemory.fields.itemHeadingPlaceholder')}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                              {t('projectMemory.fields.verify')}
                            </label>
                            <textarea
                              value={item.verify}
                              onChange={(event) => updateTemplateEditorItem(item.id, 'verify', event.target.value)}
                              placeholder={t('projectMemory.fields.verifyPlaceholder')}
                              className="min-h-[84px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                              {t('projectMemory.fields.pattern')}
                            </label>
                            <textarea
                              value={item.pattern}
                              onChange={(event) => updateTemplateEditorItem(item.id, 'pattern', event.target.value)}
                              placeholder={t('projectMemory.fields.patternPlaceholder')}
                              className="min-h-[84px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-border/60 bg-muted/15 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold tracking-tight text-foreground">{t('projectMemory.editor.sopStepsTitle')}</h4>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('projectMemory.editor.sopStepsLead')}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={addSopEditorStep}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      {t('projectMemory.actions.addStep')}
                    </Button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {formalAssetEditor.steps.map((step, index) => (
                      <div key={step.id} className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{t('projectMemory.labels.step', { count: index + 1 })}</p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive"
                            onClick={() => removeSopEditorStep(step.id)}
                            disabled={formalAssetEditor.steps.length <= 1}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            {t('projectMemory.actions.removeStep')}
                          </Button>
                        </div>
                        <div className="mt-3 grid gap-3">
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                              {t('projectMemory.fields.stepTitle')}
                            </label>
                            <Input
                              value={step.title}
                              onChange={(event) => updateSopEditorStep(step.id, 'title', event.target.value)}
                              placeholder={t('projectMemory.fields.stepTitlePlaceholder')}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
                              {t('projectMemory.fields.instruction')}
                            </label>
                            <textarea
                              value={step.instruction}
                              onChange={(event) => updateSopEditorStep(step.id, 'instruction', event.target.value)}
                              placeholder={t('projectMemory.fields.instructionPlaceholder')}
                              className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
              <p className="text-xs text-muted-foreground">{t('projectMemory.editor.footerHint')}</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => setFormalAssetEditor(null)}>
                  {t('projectMemory.actions.cancel')}
                </Button>
                <Button type="button" onClick={() => { handleSaveFormalAsset().catch(() => {}); }} disabled={formalAssetEditorBusy}>
                  {formalAssetEditorBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {t('projectMemory.actions.saveAsset')}
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
      {viewingReport ? ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm md:p-6"
          onClick={closeReportViewer}
        >
          <div
            className="flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-[34px] border border-border/70 bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{viewingReport.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {viewingReport.displayName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleViewerDownload}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {t('reportPreview.download')}
                </Button>
                <Button size="sm" variant="ghost" onClick={closeReportViewer}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {viewerLoading ? (
                <div className="flex h-full items-center justify-center p-8">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t('reportPreview.previewLoading')}</span>
                </div>
              ) : viewerError ? (
                <div className="flex h-full items-center justify-center p-8">
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {t('reportPreview.previewError', { message: viewerError })}
                  </div>
                </div>
              ) : (() => {
                const kind = getReportPreviewKind(viewingReport.relativePath || viewingReport.title);

                if (kind === 'pdf' && viewerBlobUrl) {
                  return (
                    <iframe
                      src={viewerBlobUrl}
                      title={viewingReport.title}
                      className="h-full w-full border-0"
                      style={{ minHeight: '70vh' }}
                    />
                  );
                }

                if (kind === 'image' && viewerBlobUrl) {
                  return (
                    <div className="flex h-full items-center justify-center overflow-auto bg-muted/10 p-6">
                      <img
                        src={viewerBlobUrl}
                        alt={viewingReport.title}
                        className="max-h-full max-w-full rounded-lg border border-border/60 object-contain shadow-sm"
                      />
                    </div>
                  );
                }

                if (kind === 'docx' && viewerDocxBuffer) {
                  return (
                    <div className="overflow-auto p-6">
                      <div className="mx-auto max-w-4xl rounded-2xl border border-border/60 bg-background/80 p-6 shadow-sm">
                        <DocxHtmlPreview arrayBuffer={viewerDocxBuffer} />
                      </div>
                    </div>
                  );
                }

                if (kind === 'html' && viewerTextContent) {
                  return (
                    <iframe
                      srcDoc={viewerTextContent}
                      title={viewingReport.title}
                      className="h-full w-full border-0"
                      sandbox="allow-same-origin"
                      style={{ minHeight: '70vh' }}
                    />
                  );
                }

                if (kind === 'markdown' && viewerTextContent) {
                  return (
                    <div className="overflow-auto p-6">
                      <div className="prose prose-sm mx-auto max-w-4xl rounded-2xl border border-border/60 bg-background/80 p-6 shadow-sm dark:prose-invert">
                        <ReactMarkdown>{viewerTextContent}</ReactMarkdown>
                      </div>
                    </div>
                  );
                }

                if (kind === 'text' && viewerTextContent !== null) {
                  return (
                    <div className="overflow-auto p-6">
                      <pre className="mx-auto max-w-4xl overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-border/60 bg-muted/30 p-5 font-mono text-xs leading-relaxed text-foreground shadow-sm">
                        {viewerTextContent}
                      </pre>
                    </div>
                  );
                }

                return (
                  <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                    <p className="text-sm text-muted-foreground">{t('reportPreview.unsupportedType')}</p>
                    <Button variant="outline" onClick={handleViewerDownload}>
                      <Download className="mr-1.5 h-4 w-4" />
                      {t('reportPreview.download')}
                    </Button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

    </div>
  );
}
