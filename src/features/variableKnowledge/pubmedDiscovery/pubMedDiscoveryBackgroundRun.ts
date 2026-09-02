import { useSyncExternalStore } from 'react';
import {
  createEvidenceArticlesFromCandidate,
  finalizePubMedCandidates,
  runPubMedVariableDiscovery,
  normalizeCandidateDatabaseFamilies,
  retryPubMedExtractionBatch,
} from '../../../services/pubmed/pubmedDiscoveryService';
import { normalizeDatabaseFamilyLabels } from '../../../../shared/publicDatabaseCatalog';
import { api } from '../../../utils/api';
import type {
  PubMedDiscoveryJob,
  PubMedDiscoveryOptions,
  PubMedDiscoveryProgressEvent,
  PubMedDiscoveryResult,
  PubMedExtractionBatchFailure,
  PubMedVariableCandidate,
  VariableEvidenceArticle,
} from './types';

export type PubMedDiscoveryBackgroundSnapshot = {
  job: PubMedDiscoveryJob;
  candidates: PubMedVariableCandidate[];
  evidence: VariableEvidenceArticle[];
  masterCandidates: PubMedVariableCandidate[];
  masterEvidence: VariableEvidenceArticle[];
  events: PubMedDiscoveryProgressEvent[];
  failedBatches: PubMedExtractionBatchFailure[];
  lastOptions: PubMedDiscoveryOptions | null;
  isRunning: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
};

type PubMedDiscoveryListener = () => void;

const ACCOUNT_STATE_KEY = 'backgroundSnapshot';
const ACCOUNT_STORAGE_OWNER_DEFAULT = 'default';
const LEGACY_STORAGE_KEY = 'medhelp.pubmedDiscovery.backgroundSnapshot.v1';
const listeners = new Set<PubMedDiscoveryListener>();
let activeRun: Promise<PubMedDiscoveryResult> | null = null;
let activeRunController: AbortController | null = null;
let activeRunGeneration = 0;
let snapshotRevision = 0;
let hydratedOwnerKey: string | null = null;
let hydrationPromiseOwnerKey: string | null = null;
let hydrationPromise: Promise<void> | null = null;

function createEmptyDiscoveryJob(frequency: PubMedDiscoveryOptions['frequency']): PubMedDiscoveryJob {
  const now = new Date().toISOString();
  const dateTo = now.slice(0, 10);
  const dateFrom = new Date(now);
  dateFrom.setDate(dateFrom.getDate() - (frequency === 'daily' ? 1 : 7));

  return {
    id: `job_pubmed_empty_${frequency}`,
    job_type: frequency,
    query_text: '',
    date_from: dateFrom.toISOString().slice(0, 10),
    date_to: dateTo,
    total_articles: 0,
    candidate_count: 0,
    matched_existing_count: 0,
    pending_review_count: 0,
    status: 'success',
    created_at: now,
    finished_at: now,
  };
}

function createEmptySnapshot(frequency: PubMedDiscoveryOptions['frequency']): PubMedDiscoveryBackgroundSnapshot {
  return {
    job: createEmptyDiscoveryJob(frequency),
    candidates: [],
    evidence: [],
    masterCandidates: [],
    masterEvidence: [],
    events: [],
    failedBatches: [],
    lastOptions: null,
    isRunning: false,
    statusMessage: null,
    errorMessage: null,
  };
}

function getExtractionLabel(job: PubMedDiscoveryJob) {
  if (job.extraction_source === 'claude_json') {
    const modelLabel = job.extraction_model ? ` / ${job.extraction_model}` : '';
    return `系统 Claude JSON 提取${modelLabel}`;
  }
  if (job.extraction_source === 'rule_based') return '本地规则题名预抽取';
  return '未知抽取来源';
}

function isValidSnapshot(value: unknown): value is PubMedDiscoveryBackgroundSnapshot {
  const candidate = value as Partial<PubMedDiscoveryBackgroundSnapshot>;
  return Boolean(
    candidate
    && typeof candidate === 'object'
    && candidate.job
    && Array.isArray(candidate.candidates)
    && Array.isArray(candidate.evidence)
    && Array.isArray(candidate.events)
    && typeof candidate.isRunning === 'boolean',
  );
}

function normalizePersistedSnapshot(value: unknown): PubMedDiscoveryBackgroundSnapshot | null {
  if (!isValidSnapshot(value)) return null;
  const migratedMasterCandidates = Array.isArray(value.masterCandidates) && value.masterCandidates.length > 0
    ? value.masterCandidates
    : value.candidates.filter(isReviewedVariableCandidate);
  const migratedMasterEvidence = Array.isArray(value.masterEvidence) && value.masterEvidence.length > 0
    ? value.masterEvidence
    : value.evidence;
  return {
    ...value,
    candidates: value.candidates.map(normalizeCandidateDatabaseFamilies),
    masterCandidates: migratedMasterCandidates.map(normalizeCandidateDatabaseFamilies),
    masterEvidence: migratedMasterEvidence,
    failedBatches: Array.isArray(value.failedBatches) ? value.failedBatches : [],
    lastOptions: value.lastOptions || null,
  };
}

function readLegacyPersistedSnapshot() {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    const normalized = normalizePersistedSnapshot(parsed);
    if (!normalized) return null;

    if (normalized.isRunning) {
      return {
        ...normalized,
        isRunning: false,
        errorMessage: '页面刷新后，前端后台任务已中断；已保留刷新前日志，请重新运行本轮自动发现。',
      };
    }

    return normalized;
  } catch {
    return null;
  }
}

function clearLegacyPersistedSnapshot() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore browser storage failures; account-bound storage is authoritative.
  }
}

async function readAccountPersistedSnapshot() {
  const response = await api.pubmedDiscovery.getState(ACCOUNT_STATE_KEY);
  if (!response.ok) {
    throw new Error(`Failed to load PubMed discovery state (${response.status})`);
  }

  const data = await response.json();
  return normalizePersistedSnapshot(data?.payload);
}

function persistSnapshot(nextSnapshot: PubMedDiscoveryBackgroundSnapshot) {
  void api.pubmedDiscovery.saveState(ACCOUNT_STATE_KEY, nextSnapshot)
    .then((response) => {
      if (response.ok) clearLegacyPersistedSnapshot();
    })
    .catch(() => {
      // In-memory state still works for the current session; the UI can retry on the next change.
    });
}

let snapshot = createEmptySnapshot('daily');

function notifyPubMedDiscoveryListeners() {
  listeners.forEach((listener) => listener());
}

function updateSnapshot(
  updater: (current: PubMedDiscoveryBackgroundSnapshot) => PubMedDiscoveryBackgroundSnapshot,
) {
  snapshot = updater(snapshot);
  snapshotRevision += 1;
  persistSnapshot(snapshot);
  notifyPubMedDiscoveryListeners();
}

export function getPubMedDiscoveryBackgroundSnapshot() {
  return snapshot;
}

export function hydratePubMedDiscoveryBackgroundRun(ownerKey = ACCOUNT_STORAGE_OWNER_DEFAULT) {
  const nextOwnerKey = ownerKey || ACCOUNT_STORAGE_OWNER_DEFAULT;
  const ownerChanged = hydratedOwnerKey !== nextOwnerKey;

  if (ownerChanged) {
    hydratedOwnerKey = nextOwnerKey;
    snapshot = createEmptySnapshot('daily');
    snapshotRevision += 1;
    notifyPubMedDiscoveryListeners();
  }

  if (hydrationPromise && hydrationPromiseOwnerKey === nextOwnerKey) {
    return hydrationPromise;
  }

  const revisionAtStart = snapshotRevision;
  const requestedOwnerKey = nextOwnerKey;
  const promise = (async () => {
    let accountSnapshot: PubMedDiscoveryBackgroundSnapshot | null = null;
    try {
      accountSnapshot = await readAccountPersistedSnapshot();
    } catch {
      accountSnapshot = null;
    }

    const legacySnapshot = readLegacyPersistedSnapshot();
    const nextSnapshot = accountSnapshot ?? legacySnapshot;
    if (!nextSnapshot) {
      if (legacySnapshot) clearLegacyPersistedSnapshot();
      return;
    }

    if (hydratedOwnerKey !== requestedOwnerKey || snapshotRevision !== revisionAtStart || activeRun) {
      return;
    }

    snapshot = nextSnapshot;
    snapshotRevision += 1;
    notifyPubMedDiscoveryListeners();

    if (!accountSnapshot && legacySnapshot) {
      persistSnapshot(nextSnapshot);
    } else if (accountSnapshot && legacySnapshot) {
      clearLegacyPersistedSnapshot();
    }
  })();

  hydrationPromiseOwnerKey = nextOwnerKey;
  const wrappedPromise = promise.finally(() => {
    if (hydrationPromise === wrappedPromise) {
      hydrationPromise = null;
      hydrationPromiseOwnerKey = null;
    }
  });
  hydrationPromise = wrappedPromise;

  return hydrationPromise;
}

export function subscribePubMedDiscoveryBackgroundRun(listener: PubMedDiscoveryListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribes React components to the module snapshot so completion/progress always triggers a re-render (fixes stale UI vs useState+effect). */
export function usePubMedDiscoveryBackgroundSnapshot(): PubMedDiscoveryBackgroundSnapshot {
  return useSyncExternalStore(
    subscribePubMedDiscoveryBackgroundRun,
    getPubMedDiscoveryBackgroundSnapshot,
    getPubMedDiscoveryBackgroundSnapshot,
  );
}

export function startPubMedDiscoveryBackgroundRun(options: PubMedDiscoveryOptions) {
  if (activeRun) {
    updateSnapshot((current) => ({
      ...current,
      statusMessage: 'PubMed 自动发现已在后台运行，本次不会重复启动。',
    }));
    return activeRun;
  }

  const runController = new AbortController();
  const runGeneration = activeRunGeneration + 1;
  activeRunGeneration = runGeneration;
  activeRunController = runController;
  const isCurrentRun = () => activeRunGeneration === runGeneration;

  updateSnapshot((current) => ({
    ...createEmptySnapshot(options.frequency),
    masterCandidates: current.masterCandidates,
    masterEvidence: current.masterEvidence,
    job: {
      ...createEmptyDiscoveryJob(options.frequency),
      status: 'running',
      created_at: new Date().toISOString(),
      finished_at: undefined,
    },
    lastOptions: options,
    isRunning: true,
  }));

  let runPromise: Promise<PubMedDiscoveryResult>;
  runPromise = runPubMedVariableDiscovery(options, {
    signal: runController.signal,
    onProgress: (event) => {
      if (!isCurrentRun()) return;
      updateSnapshot((current) => ({
        ...current,
        events: [...current.events, event].slice(-80),
      }));
    },
    onCandidates: (update) => {
      if (!isCurrentRun()) return;
      updateSnapshot((current) => ({
        ...current,
        candidates: update.candidates,
        failedBatches: update.failedBatches,
        statusMessage: update.totalBatches > 0
          ? `正在增量整理候选：摘要批次 ${update.completedBatches}/${update.totalBatches}。`
          : `本地题名预抽取已发现 ${update.candidates.length} 个变量候选。`,
      }));
    },
  }).then((result) => {
    if (!isCurrentRun()) {
      return result;
    }

    if (runController.signal.aborted || result.job.status === 'cancelled') {
      updateSnapshot((current) => ({
        ...current,
        job: current.job.status === 'cancelled' ? current.job : result.job,
        isRunning: false,
        errorMessage: null,
        statusMessage: current.statusMessage || '已暂停本轮 PubMed 自动发现；网络恢复后可重新运行。',
      }));
      return result;
    }

    const sourceLabel = result.job.error_message
      ? `（PubMed 接口失败，本轮保持空白结果；原因：${result.job.error_message}）`
      : `（来自 PubMed 文献动态接口，${getExtractionLabel(result.job)}）`;

    updateSnapshot((current) => ({
      ...current,
      job: result.job,
      candidates: result.candidates,
      evidence: result.matchedEvidence,
      failedBatches: result.failedBatches || [],
      isRunning: false,
      errorMessage: null,
      statusMessage: `已完成 ${options.frequency === 'daily' ? '每日' : '每周'} PubMed 自动发现${sourceLabel}：检索 ${result.job.total_articles} 篇，发现 ${result.job.candidate_count} 个候选。`,
    }));

    return result;
  }).catch((error) => {
    const message = error instanceof Error ? error.message : 'PubMed 自动发现运行失败';
    if (!isCurrentRun()) {
      return Promise.reject(error);
    }

    if (runController.signal.aborted) {
      updateSnapshot((current) => ({
        ...current,
        job: {
          ...current.job,
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          error_message: '用户已暂停本轮 PubMed 自动发现。',
        },
        isRunning: false,
        errorMessage: null,
        statusMessage: '已暂停本轮 PubMed 自动发现；网络恢复后可重新运行。',
      }));
      return Promise.reject(error);
    }

    updateSnapshot((current) => ({
      ...current,
      isRunning: false,
      errorMessage: message,
      statusMessage: null,
    }));
    throw error;
  }).finally(() => {
    if (isCurrentRun() && activeRunController === runController) {
      activeRunController = null;
    }
    if (isCurrentRun() && activeRun === runPromise) {
      activeRun = null;
    }
  });

  activeRun = runPromise;
  return activeRun;
}

export async function retryPubMedDiscoveryFailedBatch(batchId: string) {
  const failure = snapshot.failedBatches.find((batch) => batch.id === batchId);
  const options = snapshot.lastOptions;
  if (!failure || !options || snapshot.isRunning) return false;

  const startedAt = new Date().toISOString();
  updateSnapshot((current) => ({
    ...current,
    failedBatches: current.failedBatches.map((batch) => (
      batch.id === batchId ? { ...batch, retry_status: 'retrying' as const } : batch
    )),
    events: [...current.events, {
      id: `progress_retry_${Date.now()}`,
      phase: 'llm_abstract_refine' as const,
      label: `重新抽取摘要批次 ${failure.batch_index}`,
      detail: `PMID: ${failure.pmids.join(', ')}`,
      status: 'running' as const,
      createdAt: startedAt,
      startedAt,
      timeoutMs: 90_000,
      progress: 0,
    }].slice(-80),
    statusMessage: `正在重新抽取摘要批次 ${failure.batch_index}…`,
  }));

  try {
    const result = await retryPubMedExtractionBatch(failure, options, snapshot.job.id);
    updateSnapshot((current) => {
      const failedBatches = current.failedBatches.filter((batch) => batch.id !== batchId);
      const candidates = finalizePubMedCandidates([...current.candidates, ...result.candidates]);
      const retriedEvidence = candidates
        .filter((candidate) => candidate.match_status === 'matched' && candidate.matched_variable_id)
        .flatMap((candidate) => createEvidenceArticlesFromCandidate(candidate, candidate.matched_variable_id as string));
      return {
        ...current,
        candidates,
        evidence: retriedEvidence,
        failedBatches,
        job: {
          ...current.job,
          status: failedBatches.length > 0 ? 'partial' : 'success',
          candidate_count: candidates.length,
          pending_review_count: candidates.filter((candidate) => candidate.review_status === 'pending').length,
          failed_batch_count: failedBatches.length,
          successful_batch_count: (current.job.successful_batch_count || 0) + 1,
          extraction_note: failedBatches.length > 0
            ? `仍有 ${failedBatches.length} 个摘要批次待重试。`
            : undefined,
        },
        events: [...current.events, {
          id: `progress_retry_success_${Date.now()}`,
          phase: 'llm_abstract_refine' as const,
          label: `摘要批次 ${failure.batch_index} 重试成功`,
          detail: result.candidates.length > 0
            ? `新增或验证候选 ${result.candidates.length} 个。`
            : '模型已重新读取该批次摘要，未发现符合入库标准的候选变量；该批次不再计为失败。',
          status: 'success' as const,
          createdAt: new Date().toISOString(),
          startedAt,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          progress: 100,
        }].slice(-80),
        statusMessage: failedBatches.length > 0
          ? `批次 ${failure.batch_index} 已补齐；仍有 ${failedBatches.length} 个失败批次。`
          : `所有失败批次已重新抽取完成。`,
      };
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '重新抽取失败';
    updateSnapshot((current) => ({
      ...current,
      failedBatches: current.failedBatches.map((batch) => (
        batch.id === batchId
          ? { ...batch, retry_status: 'failed' as const, error_message: message }
          : batch
      )),
      events: [...current.events, {
        id: `progress_retry_failed_${Date.now()}`,
        phase: 'llm_abstract_refine' as const,
        label: `摘要批次 ${failure.batch_index} 重试失败`,
        detail: message,
        status: 'warning' as const,
        createdAt: new Date().toISOString(),
        startedAt,
        durationMs: Date.now() - new Date(startedAt).getTime(),
        progress: 100,
      }].slice(-80),
      statusMessage: `批次 ${failure.batch_index} 仍未完成，可稍后再次重试。`,
    }));
    return false;
  }
}

export function cancelPubMedDiscoveryBackgroundRun() {
  if (!activeRun && !snapshot.isRunning) {
    return false;
  }

  activeRunController?.abort();
  activeRunGeneration += 1;
  activeRunController = null;
  activeRun = null;
  const now = new Date().toISOString();
  const cancelledEvent: PubMedDiscoveryProgressEvent = {
    id: `progress_cancelled_${Date.now()}`,
    phase: 'cancelled',
    label: '已暂停本轮自动发现',
    detail: '已取消前端等待中的 PubMed/LLM 请求；可调整网络或筛选条件后重新运行。',
    status: 'cancelled',
    createdAt: now,
  };
  updateSnapshot((current) => ({
    ...current,
    job: {
      ...current.job,
      status: 'cancelled',
      finished_at: now,
      error_message: '用户已暂停本轮 PubMed 自动发现。',
    },
    events: [
      ...current.events,
      cancelledEvent,
    ].slice(-80),
    isRunning: false,
    errorMessage: null,
    statusMessage: '已暂停本轮 PubMed 自动发现；网络恢复后可重新运行。',
  }));
  return true;
}

export function resetPubMedDiscoveryBackgroundRun(frequency: PubMedDiscoveryOptions['frequency']) {
  if (snapshot.isRunning) {
    updateSnapshot((current) => ({
      ...current,
      statusMessage: '后台自动发现任务仍在运行，完成后再重置。',
    }));
    return false;
  }

  updateSnapshot((current) => ({
    ...createEmptySnapshot(frequency),
    masterCandidates: current.masterCandidates,
    masterEvidence: current.masterEvidence,
  }));
  return true;
}

function createVariableId(candidate: PubMedVariableCandidate) {
  const source = candidate.canonical_name_guess || candidate.raw_name || candidate.display_name_en_guess || candidate.display_name_zh_guess;
  return `variable_${source.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled'}`;
}

function masterRowIdForCandidate(candidate: PubMedVariableCandidate) {
  return candidate.matched_variable_id || createVariableId(candidate);
}

function isReviewedVariableCandidate(candidate: PubMedVariableCandidate) {
  return candidate.variable_type_guess !== 'outcome'
    && (
      candidate.review_status === 'accepted'
      || candidate.review_status === 'merged'
      || candidate.match_status === 'added_to_candidate_pool'
      || candidate.match_status === 'merged'
    );
}

function upsertCandidate(list: PubMedVariableCandidate[], candidate: PubMedVariableCandidate) {
  const targetId = candidate.matched_variable_id || createVariableId(candidate);
  const existingIndex = list.findIndex((item) => (
    item.id === candidate.id
    || item.matched_variable_id === targetId
    || createVariableId(item) === targetId
  ));

  if (existingIndex === -1) {
    return [{ ...candidate, matched_variable_id: targetId }, ...list];
  }

  return list.map((item, index) => {
    if (index !== existingIndex) return item;

    if (item.id === candidate.id) {
      return {
        ...item,
        ...candidate,
        matched_variable_id: targetId,
        created_at: item.created_at || candidate.created_at,
        updated_at: candidate.updated_at || item.updated_at,
      };
    }

    return {
      ...item,
      matched_variable_id: targetId,
      confidence_score: Math.max(item.confidence_score, candidate.confidence_score),
      database_family_guess: normalizeDatabaseFamilyLabels([
        ...item.database_family_guess,
        ...candidate.database_family_guess,
      ]),
      clinical_domain_guess: [...new Set([...item.clinical_domain_guess, ...candidate.clinical_domain_guess])],
      role_guess: [...new Set([...item.role_guess, ...candidate.role_guess])],
      updated_at: candidate.updated_at || item.updated_at,
    };
  });
}

export function applyPubMedDiscoveryCandidateUpdate({
  candidate,
  evidence,
  evidences,
  statusMessage,
}: {
  candidate: PubMedVariableCandidate;
  evidence?: VariableEvidenceArticle;
  evidences?: VariableEvidenceArticle[];
  statusMessage?: string;
}) {
  const stableCandidate = isReviewedVariableCandidate(candidate)
    ? { ...candidate, matched_variable_id: candidate.matched_variable_id || createVariableId(candidate) }
    : candidate;
  const nextEvidence = evidences?.length ? evidences : evidence ? [evidence] : [];
  updateSnapshot((current) => ({
    ...current,
    candidates: current.candidates.map((item) => (
      item.id === stableCandidate.id ? stableCandidate : item
    )),
    evidence: nextEvidence.length ? [...nextEvidence, ...current.evidence] : current.evidence,
    masterCandidates: isReviewedVariableCandidate(stableCandidate)
      ? upsertCandidate(current.masterCandidates, stableCandidate)
      : current.masterCandidates,
    masterEvidence: nextEvidence.length ? [...nextEvidence, ...current.masterEvidence] : current.masterEvidence,
    statusMessage: statusMessage ?? current.statusMessage,
  }));
}

export function removePubMedDiscoveryMasterVariable(
  variableId: string,
  options?: { statusMessage?: string },
) {
  updateSnapshot((current) => ({
    ...current,
    masterCandidates: current.masterCandidates.filter(
      (item) => masterRowIdForCandidate(item) !== variableId,
    ),
    masterEvidence: current.masterEvidence.filter((item) => item.variable_id !== variableId),
    statusMessage: options?.statusMessage ?? current.statusMessage,
  }));
}
