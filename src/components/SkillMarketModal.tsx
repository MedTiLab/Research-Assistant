import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';

type MarketSource = 'clawhub' | 'skillhub';
type InstallState = 'installable' | 'installed' | 'conflict' | 'unavailable';

type MarketSkill = {
  id: string;
  source: MarketSource;
  slug: string;
  name: string;
  summary: string;
  author?: string;
  downloads: number;
  stars?: number;
  version?: string | null;
  tags: string[];
  securityStatus: 'verified' | 'benign' | 'unknown' | 'flagged';
  installState: InstallState;
};

type SkillMarketModalProps = {
  projectName?: string | null;
  onClose: () => void;
  onSkillsChanged: () => void | Promise<void>;
};

const COPY = {
  zh: {
    title: '技能市场',
    subtitle: '浏览来自 SkillHub 和 ClawHub 的第三方技能，并安装到当前账号的本机私有目录。',
    disclaimer: '第三方技能可能包含脚本和外部指令。安装前请确认来源与安全状态，运行时仍受本机 AI 权限控制。',
    search: '搜索技能、作者或用途…',
    allSources: '全部来源',
    loading: '正在加载技能市场…',
    empty: '没有找到匹配的技能。',
    retry: '重试',
    install: '安装',
    installing: '安装中…',
    installed: '已安装',
    remove: '移除',
    conflict: '名称冲突',
    unavailable: '不可安装',
    downloads: '次下载',
    confirmTitle: '安装第三方技能？',
    confirmBody: '该技能会被下载到你的本机用户目录，Claude 和 Codex 可在后续会话中读取它。',
    cancel: '取消',
    confirm: '确认安装',
    unknownSecurity: '未验证',
    verified: '已验证',
    benign: '扫描通过',
    flagged: '存在风险',
  },
  en: {
    title: 'Skill Market',
    subtitle: 'Browse third-party skills from SkillHub and ClawHub and install them into your private local account directory.',
    disclaimer: 'Third-party skills may contain scripts and external instructions. Review their source and security status before installing; execution remains governed by local AI permissions.',
    search: 'Search skills, authors, or use cases…',
    allSources: 'All sources',
    loading: 'Loading skill market…',
    empty: 'No matching skills found.',
    retry: 'Retry',
    install: 'Install',
    installing: 'Installing…',
    installed: 'Installed',
    remove: 'Remove',
    conflict: 'Name conflict',
    unavailable: 'Unavailable',
    downloads: 'downloads',
    confirmTitle: 'Install third-party skill?',
    confirmBody: 'This skill will be downloaded to your private local user directory. Claude and Codex can read it in subsequent sessions.',
    cancel: 'Cancel',
    confirm: 'Install skill',
    unknownSecurity: 'Unverified',
    verified: 'Verified',
    benign: 'Scan passed',
    flagged: 'Risk detected',
  },
};

function compactCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value || 0);
}

function securityClass(status: MarketSkill['securityStatus']) {
  if (status === 'flagged') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200';
  if (status === 'verified' || status === 'benign') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200';
  return 'border-border bg-muted/50 text-muted-foreground';
}

export default function SkillMarketModal({ projectName, onClose, onSkillsChanged }: SkillMarketModalProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const text = COPY[locale];
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | MarketSource>('all');
  const [skills, setSkills] = useState<MarketSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<MarketSkill | null>(null);
  const requestIdRef = useRef(0);

  const loadMarket = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await api.listSkillMarket({ query: query.trim(), source, limit: 36 });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to load skill market');
      if (requestId === requestIdRef.current) setSkills(Array.isArray(payload.items) ? payload.items : []);
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load skill market');
        setSkills([]);
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [query, source]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMarket(), 250);
    return () => window.clearTimeout(timer);
  }, [loadMarket]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingInstall) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, pendingInstall]);

  const installSkill = useCallback(async () => {
    if (!pendingInstall) return;
    const skill = pendingInstall;
    setPendingInstall(null);
    setInstallingId(skill.id);
    setActionError(null);
    try {
      const response = await api.installSkillMarket(skill.id, projectName);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to install skill');
      setSkills((current) => current.map((item) => (
        item.id === skill.id ? { ...item, installState: 'installed' } : item
      )));
      await onSkillsChanged();
    } catch (installError) {
      setActionError(installError instanceof Error ? installError.message : 'Failed to install skill');
    } finally {
      setInstallingId(null);
    }
  }, [onSkillsChanged, pendingInstall, projectName]);

  const removeSkill = useCallback(async (skill: MarketSkill) => {
    setInstallingId(skill.id);
    setActionError(null);
    try {
      const response = await api.uninstallSkillMarket(skill.source, skill.slug);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to remove skill');
      setSkills((current) => current.map((item) => (
        item.id === skill.id ? { ...item, installState: 'installable' } : item
      )));
      await onSkillsChanged();
    } catch (removeError) {
      setActionError(removeError instanceof Error ? removeError.message : 'Failed to remove skill');
    } finally {
      setInstallingId(null);
    }
  }, [onSkillsChanged]);

  const sourceLabel = useMemo(() => ({ clawhub: 'ClawHub', skillhub: 'SkillHub' }), []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        className="flex h-[min(880px,94vh)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border bg-card px-5 py-4">
          <span className="mt-0.5 rounded-xl border border-border bg-background p-2 text-sky-600 dark:text-sky-300">
            <Store className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground">{text.title}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{text.subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="shrink-0 space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={text.search}
                aria-label={text.search}
                className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-9 text-sm text-foreground outline-none focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Clear">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as 'all' | MarketSource)}
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-sky-300/70"
            >
              <option value="all">{text.allSources}</option>
              <option value="skillhub">SkillHub</option>
              <option value="clawhub">ClawHub</option>
            </select>
            <button type="button" onClick={() => void loadMarket()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {text.retry}
            </button>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-100">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{text.disclaimer}</span>
          </div>
          {actionError && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">{actionError}</div>}
        </div>

        <div className="panel-scroll-area min-h-0 flex-1 overflow-y-auto p-5">
          {loading && skills.length === 0 && (
            <div className="flex h-full min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {text.loading}
            </div>
          )}
          {!loading && error && (
            <div role="alert" className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-red-300 bg-red-50/60 p-8 text-center dark:border-red-800 dark:bg-red-950/20">
              <ShieldAlert className="h-7 w-7 text-red-500" />
              <p className="max-w-xl text-sm text-red-700 dark:text-red-200">{error}</p>
              <button type="button" onClick={() => void loadMarket()} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted">{text.retry}</button>
            </div>
          )}
          {!loading && !error && skills.length === 0 && (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <PackageSearch className="h-8 w-8" />
              <p className="text-sm">{text.empty}</p>
            </div>
          )}
          {skills.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {skills.map((skill) => {
                const actionPending = installingId === skill.id;
                const securityLabel = skill.securityStatus === 'verified'
                  ? text.verified
                  : skill.securityStatus === 'benign'
                    ? text.benign
                    : skill.securityStatus === 'flagged'
                      ? text.flagged
                      : text.unknownSecurity;
                return (
                  <article key={skill.id} className="flex min-h-60 flex-col rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-sm font-semibold text-foreground">
                        {skill.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={skill.name}>{skill.name}</h3>
                          {skill.version && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">v{skill.version}</span>}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {sourceLabel[skill.source]}{skill.author ? ` · ${skill.author}` : ''}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-3 min-h-[60px] text-sm leading-5 text-muted-foreground">{skill.summary || skill.slug}</p>
                    <div className="mt-3 flex min-h-6 flex-wrap gap-1.5">
                      {skill.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">#{tag}</span>)}
                    </div>
                    <footer className="mt-auto flex items-center gap-2 border-t border-border pt-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${securityClass(skill.securityStatus)}`}>
                        {skill.securityStatus === 'flagged' ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                        {securityLabel}
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{compactCount(skill.downloads)} {text.downloads}</span>
                      {skill.installState === 'installable' && (
                        <button type="button" onClick={() => setPendingInstall(skill)} disabled={actionPending} className="inline-flex items-center gap-1 rounded-lg border border-sky-500 bg-sky-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-50">
                          {actionPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          {actionPending ? text.installing : text.install}
                        </button>
                      )}
                      {skill.installState === 'installed' && (
                        <button type="button" onClick={() => void removeSkill(skill)} disabled={actionPending} className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
                          {actionPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          {actionPending ? text.installing : text.remove}
                        </button>
                      )}
                      {skill.installState === 'conflict' && <span className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground">{text.conflict}</span>}
                      {skill.installState === 'unavailable' && <span className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground">{text.unavailable}</span>}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {pendingInstall && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setPendingInstall(null)}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground">{text.confirmTitle}</h3>
            <p className="mt-2 text-sm font-medium text-foreground">{pendingInstall.name}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{text.confirmBody}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingInstall(null)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted">{text.cancel}</button>
              <button type="button" onClick={() => void installSkill()} className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600">
                <Check className="h-4 w-4" />
                {text.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
