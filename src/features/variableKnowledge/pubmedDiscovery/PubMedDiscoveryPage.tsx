import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getPublicDatabaseLabels } from '../../../../shared/publicDatabaseCatalog';
import { cn } from '../../../lib/utils';
import {
  addCandidateToPool,
  calculateSummaryStats,
  ignoreCandidate,
  markCandidateAmbiguous,
  mergeCandidateToExistingVariable,
} from '../../../services/pubmed/pubmedDiscoveryService';
import type { Project } from '../../../types/app';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import { useAuth } from '../../../contexts/AuthContext';
import type { PubMedVariableCandidate } from './types';
import {
  applyPubMedDiscoveryCandidateUpdate,
  cancelPubMedDiscoveryBackgroundRun,
  getPubMedDiscoveryBackgroundSnapshot,
  hydratePubMedDiscoveryBackgroundRun,
  removePubMedDiscoveryMasterVariable,
  resetPubMedDiscoveryBackgroundRun,
  retryPubMedDiscoveryFailedBatch,
  startPubMedDiscoveryBackgroundRun,
  usePubMedDiscoveryBackgroundSnapshot,
} from './pubMedDiscoveryBackgroundRun';
import PubMedCandidateDetailPanel from './PubMedCandidateDetailPanel';
import PubMedCandidateTable from './PubMedCandidateTable';
import PubMedDiscoveryFilters from './PubMedDiscoveryFilters';
import PubMedDiscoveryHeader from './PubMedDiscoveryHeader';
import PubMedDiscoveryRunStatusPanel from './PubMedDiscoveryRunStatusPanel';
import PubMedDiscoverySummaryCards from './PubMedDiscoverySummaryCards';
import PubMedVariableMasterTable from './PubMedVariableMasterTable';
import type { CandidateFilters } from './utils';
import { filterCandidates } from './utils';

type DiscoveryTab = 'discovery' | 'master';

export type PubMedEmbeddedMode = 'full' | 'overview' | 'discovery';

const DISCOVERY_TABS: Array<{ id: DiscoveryTab; label: string }> = [
  { id: 'master', label: '📚 变量总览' },
  { id: 'discovery', label: '🧪 候选审核' },
];

/** 嵌入式「发现」模式：主区域即为候选流程，不再显示顶部分区标签。 */
const DISCOVERY_TABS_EMBEDDED_DISCOVERY: Array<{ id: DiscoveryTab; label: string }> = [];

function discoverySubTabButtonClass(tabId: DiscoveryTab, isActive: boolean): string {
  const base = 'rounded-lg px-3 py-1.5 text-center text-xs font-medium transition-colors';
  if (tabId === 'master') {
    return cn(
      base,
      isActive
        ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
    );
  }
  if (tabId === 'discovery') {
    return cn(
      base,
      isActive
        ? 'bg-foreground text-background shadow-sm ring-1 ring-border'
        : 'bg-muted/80 text-foreground/80 hover:bg-muted hover:text-foreground',
    );
  }
  return base;
}

const DEFAULT_FILTERS: CandidateFilters = {
  search: '',
  frequency: 'daily',
  databaseFamily: 'all',
  variableType: 'all',
  clinicalDomain: 'all',
  matchStatus: 'all',
};

function createVariableIdFromCandidate(candidate: PubMedVariableCandidate) {
  const sourceRaw = candidate.matched_variable_id
    || candidate.canonical_name_guess
    || candidate.raw_name
    || candidate.display_name_en_guess
    || candidate.display_name_zh_guess;
  const source = sourceRaw != null && String(sourceRaw).trim() !== ''
    ? String(sourceRaw).trim()
    : 'untitled';
  if (source.startsWith('variable_')) return source;
  return `variable_${source.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled'}`;
}

function createMergeTargetsFromOverview(candidates: PubMedVariableCandidate[]) {
  const byId = new Map<string, { id: string; label: string }>();
  candidates.forEach((candidate) => {
    if (candidate.variable_type_guess === 'outcome') return;
    const id = createVariableIdFromCandidate(candidate);
    const canonicalName = candidate.canonical_name_guess || candidate.raw_name || candidate.display_name_en_guess || candidate.display_name_zh_guess;
    const zhName = candidate.display_name_zh_guess && candidate.display_name_zh_guess !== canonicalName
      ? candidate.display_name_zh_guess
      : '';
    byId.set(id, {
      id,
      label: zhName ? `${canonicalName} · ${zhName}` : canonicalName,
    });
  });
  return Array.from(byId.values()).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}

function resolveMergeTargetId(
  candidate: PubMedVariableCandidate | null,
  mergeTargets: Array<{ id: string; label: string }>,
) {
  if (mergeTargets.length === 0) return '';
  if (!candidate) return mergeTargets[0].id;
  if (candidate.matched_variable_id && mergeTargets.some((target) => target.id === candidate.matched_variable_id)) {
    return candidate.matched_variable_id;
  }

  const candidateName = (candidate.canonical_name_guess || candidate.raw_name || '').toLowerCase();
  const matched = mergeTargets.find((target) => target.label.toLowerCase().startsWith(candidateName));
  return matched?.id || mergeTargets[0].id;
}

function createDiscoveryOptions(filters: CandidateFilters) {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo);
  const frequency = filters.frequency;
  dateFrom.setDate(dateTo.getDate() - (frequency === 'daily' ? 1 : 7));
  return {
    frequency,
    dateFrom: dateFrom.toISOString().slice(0, 10),
    dateTo: dateTo.toISOString().slice(0, 10),
    databaseFamilies: filters.databaseFamily !== 'all' ? [filters.databaseFamily] : undefined,
    variableKeyword: filters.search.trim() || undefined,
    queryMode: 'broad' as const,
  };
}

export default function PubMedDiscoveryPage({
  embedded = false,
  embeddedMode = 'full',
  chatTargetProject = null,
  onSendVariableToChat,
}: {
  embedded?: boolean;
  embeddedMode?: PubMedEmbeddedMode;
  chatTargetProject?: Project | null;
  onSendVariableToChat?: (project: Project, prompt: string | ChatPromptDraft) => void;
} = {}) {
  const mode = embeddedMode;
  const subTabs = mode === 'discovery' ? DISCOVERY_TABS_EMBEDDED_DISCOVERY : DISCOVERY_TABS;
  const { user } = useAuth() as { user: { id?: string | number } | null };

  const runSnapshot = usePubMedDiscoveryBackgroundSnapshot();
  const [activeTab, setActiveTab] = useState<DiscoveryTab>(() => {
    const snapshot = getPubMedDiscoveryBackgroundSnapshot();
    if (mode === 'discovery') {
      return 'discovery';
    }
    if (mode === 'overview') {
      return 'master';
    }
    return snapshot.isRunning ? 'discovery' : 'master';
  });
  const [filters, setFilters] = useState<CandidateFilters>(DEFAULT_FILTERS);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ruleSettingsOpen, setRuleSettingsOpen] = useState(false);
  const [dismissedCandidateIds, setDismissedCandidateIds] = useState<Set<string>>(() => new Set());
  const [dismissingCandidateIds, setDismissingCandidateIds] = useState<Set<string>>(() => new Set());
  const dismissTimersRef = useRef<number[]>([]);

  const {
    job,
    candidates,
    evidence,
    masterCandidates,
    masterEvidence,
    events: runEvents,
    failedBatches,
    isRunning,
    statusMessage,
    errorMessage,
  } = runSnapshot;

  const databaseFamilies = useMemo(() => getPublicDatabaseLabels(), []);

  useEffect(() => {
    if (!user?.id) return;
    void hydratePubMedDiscoveryBackgroundRun(String(user.id));
  }, [user?.id]);

  const clinicalDomains = useMemo(
    () => [...new Set(candidates.flatMap((candidate) => candidate.clinical_domain_guess))].sort(),
    [candidates],
  );

  const reviewQueueCandidates = useMemo(
    () => candidates.filter((candidate) => (
      (candidate.review_status === 'pending' || dismissingCandidateIds.has(candidate.id))
      && !dismissedCandidateIds.has(candidate.id)
    )),
    [candidates, dismissedCandidateIds, dismissingCandidateIds],
  );

  const filteredCandidates = useMemo(
    () => filterCandidates(reviewQueueCandidates, filters),
    [reviewQueueCandidates, filters],
  );

  const selectedCandidate = useMemo(() => {
    return reviewQueueCandidates.find((candidate) => candidate.id === selectedCandidateId)
      || filteredCandidates[0]
      || reviewQueueCandidates[0]
      || null;
  }, [filteredCandidates, reviewQueueCandidates, selectedCandidateId]);

  const summaryStats = useMemo(() => calculateSummaryStats(job, candidates), [job, candidates]);
  const mergeTargets = useMemo(() => createMergeTargetsFromOverview(masterCandidates), [masterCandidates]);

  const showSubTabs = (!embedded || mode === 'full' || mode === 'discovery') && subTabs.length > 0;
  const showOverviewOnly = mode === 'overview';
  const onDiscoverySubView = activeTab === 'discovery' && !showOverviewOnly;

  useEffect(() => {
    // Keep inner tab in sync with parent-embedded mode switches.
    if (mode === 'overview') {
      setActiveTab('master');
      return;
    }
    if (mode === 'discovery') {
      setActiveTab('discovery');
    }
  }, [mode]);

  useEffect(() => {
    if (selectedCandidate) {
      setMergeTargetId(resolveMergeTargetId(selectedCandidate, mergeTargets));
    } else if (!mergeTargetId && mergeTargets.length > 0) {
      setMergeTargetId(mergeTargets[0].id);
    }
  }, [mergeTargetId, mergeTargets, selectedCandidate]);

  useEffect(() => {
    if (reviewQueueCandidates.length === 0 && selectedCandidateId) {
      setSelectedCandidateId('');
      return;
    }

    if (reviewQueueCandidates.length > 0 && !reviewQueueCandidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(reviewQueueCandidates[0].id);
    }
  }, [reviewQueueCandidates, selectedCandidateId]);

  useEffect(() => {
    return () => {
      dismissTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      dismissTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [filteredCandidates.length, page, pageSize]);

  const handleRunDiscovery = () => {
    dismissTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    dismissTimersRef.current = [];
    setDismissedCandidateIds(new Set());
    setDismissingCandidateIds(new Set());
    setSelectedCandidateId('');
    setPage(1);
    setActiveTab('discovery');
    void startPubMedDiscoveryBackgroundRun(createDiscoveryOptions(filters)).catch(() => undefined);
  };

  const handleCancelDiscovery = () => {
    cancelPubMedDiscoveryBackgroundRun();
  };

  const handleReset = () => {
    const reset = resetPubMedDiscoveryBackgroundRun(DEFAULT_FILTERS.frequency);
    if (!reset) return;

    dismissTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    dismissTimersRef.current = [];
    setFilters(DEFAULT_FILTERS);
    setSelectedCandidateId('');
    setDismissedCandidateIds(new Set());
    setDismissingCandidateIds(new Set());
    setAdvancedOpen(false);
    setRuleSettingsOpen(false);
    setPage(1);
  };

  const dismissCandidateFromReviewQueue = (candidate: PubMedVariableCandidate) => {
    const currentIndex = filteredCandidates.findIndex((item) => item.id === candidate.id);
    const nextCandidate = currentIndex >= 0
      ? filteredCandidates[currentIndex + 1] || filteredCandidates[currentIndex - 1] || null
      : filteredCandidates.find((item) => item.id !== candidate.id) || null;

    setDismissingCandidateIds((prev) => new Set(prev).add(candidate.id));
    setSelectedCandidateId(nextCandidate?.id || '');

    const timerId = window.setTimeout(() => {
      setDismissedCandidateIds((prev) => new Set(prev).add(candidate.id));
      setDismissingCandidateIds((prev) => {
        const next = new Set(prev);
        next.delete(candidate.id);
        return next;
      });
    }, 180);
    dismissTimersRef.current.push(timerId);
  };

  const handleAddToPool = (candidate: PubMedVariableCandidate) => {
    const result = addCandidateToPool(candidate);
    applyPubMedDiscoveryCandidateUpdate({
      candidate: result.candidate,
      statusMessage: `${candidate.raw_name} 已加入候选池，并从当前候选列表收起。`,
    });
    dismissCandidateFromReviewQueue(candidate);
  };

  const handleMerge = (candidate: PubMedVariableCandidate, variableId = candidate.matched_variable_id || mergeTargetId) => {
    if (!variableId) return;
    const result = mergeCandidateToExistingVariable(candidate, variableId);
    applyPubMedDiscoveryCandidateUpdate({
      candidate: result.candidate,
      evidence: result.evidence,
      evidences: result.evidences,
      statusMessage: `${candidate.raw_name} 已合并到已有变量证据，并从当前候选列表收起。`,
    });
    dismissCandidateFromReviewQueue(candidate);
  };

  const handleMarkAmbiguous = (candidate: PubMedVariableCandidate, note = candidate.ambiguity_notes || '需要人工确认缩写含义。') => {
    const result = markCandidateAmbiguous(candidate, note);
    applyPubMedDiscoveryCandidateUpdate({
      candidate: result.candidate,
      statusMessage: `${candidate.raw_name} 已标记为缩写歧义，并从当前候选列表收起。`,
    });
    dismissCandidateFromReviewQueue(candidate);
  };

  const handleIgnore = (candidate: PubMedVariableCandidate) => {
    const result = ignoreCandidate(candidate);
    applyPubMedDiscoveryCandidateUpdate({
      candidate: result.candidate,
      statusMessage: `${candidate.raw_name} 已忽略，并从当前候选列表收起；原始记录仍保留。`,
    });
    dismissCandidateFromReviewQueue(candidate);
  };

  const handleToggleFavorite = (candidate: PubMedVariableCandidate) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
  };

  return (
    <div className={embedded ? 'w-full' : 'h-full overflow-y-auto bg-background'}>
      <div className={`mx-auto flex w-full max-w-[1600px] flex-col gap-5 ${embedded ? 'p-0' : 'p-4 sm:p-6'}`}>
        {!embedded ? <PubMedDiscoveryHeader stats={summaryStats} frequency={filters.frequency} /> : null}

        {showSubTabs ? (
        <nav
          className="flex w-full justify-center border-b border-border/60 pb-3"
          aria-label="PubMed 分区"
        >
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
            {subTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    'min-w-[5.5rem] sm:min-w-[6rem]',
                    discoverySubTabButtonClass(tab.id, isActive),
                  )}
                  onClick={() => {
                    setActiveTab(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>
        ) : null}

        {onDiscoverySubView ? (
          <PubMedDiscoveryFilters
            filters={filters}
            databaseFamilies={databaseFamilies}
            clinicalDomains={clinicalDomains}
            isRunning={isRunning}
            advancedOpen={advancedOpen}
            onFiltersChange={(nextFilters) => {
              setFilters(nextFilters);
              setPage(1);
            }}
            onRun={handleRunDiscovery}
            onCancel={handleCancelDiscovery}
            onReset={handleReset}
            onToggleAdvanced={() => setAdvancedOpen((prev) => !prev)}
            ruleSettingsOpen={ruleSettingsOpen}
            onRuleSettingsOpenChange={setRuleSettingsOpen}
          />
        ) : null}

        {onDiscoverySubView ? (
          <PubMedDiscoveryRunStatusPanel events={runEvents} isRunning={isRunning} />
        ) : null}

        {onDiscoverySubView && failedBatches.length > 0 ? (
          <section className="rounded-xl border border-rose-200/70 bg-rose-50/70 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/20">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">摘要抽取部分成功</p>
                <p className="mt-1 text-xs leading-5 text-rose-800/80 dark:text-rose-200/80">
                  已保留成功批次和题名规则候选；以下批次可单独重试，不会重跑 PubMed 搜索。
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {failedBatches.map((batch) => {
                    const isRetrying = batch.retry_status === 'retrying';
                    return (
                      <div key={batch.id} className="rounded-lg border border-rose-200/70 bg-white/70 p-3 dark:border-rose-900/50 dark:bg-slate-950/35">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground">批次 {batch.batch_index} · {batch.pmids.length} 篇</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">PMID {batch.pmids.join(' / ')}</p>
                          </div>
                          <button
                            type="button"
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-rose-300/80 bg-white px-2.5 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-800 dark:bg-slate-950 dark:text-rose-200 dark:hover:bg-rose-950/40"
                            disabled={isRunning || isRetrying}
                            onClick={() => void retryPubMedDiscoveryFailedBatch(batch.id)}
                          >
                            {isRetrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {isRetrying ? '重试中' : '重新抽取'}
                          </button>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-rose-800/75 dark:text-rose-200/75">{batch.error_message}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {statusMessage ? (
          <div className="flex items-start gap-2 rounded-xl border border-slate-200/50 bg-slate-50/80 px-4 py-3 text-sm text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/20 dark:text-slate-100">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        ) : null}

        {job.extraction_note && !job.error_message ? (
          <div className="flex items-start gap-2 rounded-xl border border-slate-200/60 bg-slate-50/80 px-4 py-3 text-sm text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/20 dark:text-slate-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{job.extraction_note}</span>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {showOverviewOnly || activeTab === 'master' ? (
          <PubMedVariableMasterTable
            appearance="default"
            candidates={masterCandidates}
            evidence={masterEvidence}
            chatTargetProject={chatTargetProject}
            onSendVariableToChat={onSendVariableToChat}
            onRemoveMasterVariable={(variableId, displayName) => {
              removePubMedDiscoveryMasterVariable(variableId, {
                statusMessage: `「${displayName}」已从变量总览移除。`,
              });
            }}
          />
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.72fr)_minmax(260px,0.78fr)]">
              <PubMedCandidateTable
                candidates={filteredCandidates}
                selectedCandidateId={selectedCandidate?.id}
                dismissingCandidateIds={dismissingCandidateIds}
                dismissedCount={dismissedCandidateIds.size}
                frequency={filters.frequency}
                page={page}
                pageSize={pageSize}
                totalCount={filteredCandidates.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                onSelectCandidate={(candidate) => setSelectedCandidateId(candidate.id)}
                onAddToPool={handleAddToPool}
                onMarkAmbiguous={handleMarkAmbiguous}
                onIgnore={handleIgnore}
              />

              <PubMedCandidateDetailPanel
                candidate={selectedCandidate}
                allCandidates={candidates}
                isFavorite={selectedCandidate ? favoriteIds.has(selectedCandidate.id) : false}
                mergeTargetId={mergeTargetId}
                mergeTargets={mergeTargets}
                onMergeTargetChange={setMergeTargetId}
                onToggleFavorite={handleToggleFavorite}
                onMerge={handleMerge}
              />
            </div>
          </>
        )}

        {onDiscoverySubView ? (
          <PubMedDiscoverySummaryCards
            candidates={candidates}
            frequency={filters.frequency}
            evidenceCount={evidence.length}
          />
        ) : null}
      </div>
    </div>
  );
}
