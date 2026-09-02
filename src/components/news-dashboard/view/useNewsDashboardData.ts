import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import type { NewsItem } from './NewsItemCard';

export type NewsSourceKey = 'pubmed' | 'europepmc' | 'medrxiv' | 'arxiv' | 'wechat' | 'xiaohongshu';

export type SourceInfo = {
  key: NewsSourceKey;
  label: string;
  hasResults: boolean;
  lastSearchDate: string | null;
  requiresCredentials: boolean;
  credentialType: string | null;
  credentialStatus: 'not_required' | 'configured' | 'missing';
};

export type SearchResults = {
  top_papers: NewsItem[];
  total_found: number;
  total_filtered: number;
  search_date?: string;
};

export type ResearchDomain = {
  keywords: string[];
  arxiv_categories: string[];
  priority: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SourceConfig = Record<string, any>;

type NewsDashboardSnapshot = {
  sources: SourceInfo[];
  configs: Record<NewsSourceKey, SourceConfig>;
  results: Record<NewsSourceKey, SearchResults>;
};

type CachedNewsDashboardSnapshot = NewsDashboardSnapshot & {
  version: number;
  cachedAt: number;
};

/** Sources shown in the literature triage UI (indexed feeds plus article/note sources). */
export const LITERATURE_TRIAGE_SOURCES: NewsSourceKey[] = ['pubmed', 'europepmc', 'medrxiv', 'arxiv', 'wechat', 'xiaohongshu'];

/** Hero column stat cards on the right: indexed sources only (no per-source count tile for social/note feeds). */
export const LITERATURE_HERO_STAT_SOURCES: NewsSourceKey[] = ['pubmed', 'europepmc', 'medrxiv', 'arxiv'];

const NEWS_DASHBOARD_CACHE_KEY = 'medhelp.newsDashboard.snapshot.v1';
const NEWS_DASHBOARD_CACHE_VERSION = 2;

function createEmptySearchResults(): SearchResults {
  return { top_papers: [], total_found: 0, total_filtered: 0 };
}

function createEmptyResultsMap(): Record<NewsSourceKey, SearchResults> {
  return LITERATURE_TRIAGE_SOURCES.reduce((accumulator, key) => {
    accumulator[key] = createEmptySearchResults();
    return accumulator;
  }, {} as Record<NewsSourceKey, SearchResults>);
}

function createEmptyConfigMap(): Record<NewsSourceKey, SourceConfig> {
  return LITERATURE_TRIAGE_SOURCES.reduce((accumulator, key) => {
    accumulator[key] = {};
    return accumulator;
  }, {} as Record<NewsSourceKey, SourceConfig>);
}

function normalizeSearchResults(raw: unknown): SearchResults {
  if (!raw || typeof raw !== 'object') {
    return createEmptySearchResults();
  }
  const r = raw as Partial<SearchResults>;
  const top = r.top_papers;
  return {
    top_papers: Array.isArray(top) ? top : [],
    total_found: typeof r.total_found === 'number' ? r.total_found : 0,
    total_filtered: typeof r.total_filtered === 'number' ? r.total_filtered : 0,
    search_date: r.search_date,
  };
}

function normalizeSources(raw: unknown): SourceInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((source): source is SourceInfo => (
    Boolean(source)
    && typeof source === 'object'
    && LITERATURE_TRIAGE_SOURCES.includes((source as SourceInfo).key)
  ));
}

function normalizeSourceConfig(raw: unknown): SourceConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as SourceConfig;
}

function normalizeConfigMap(raw: unknown): Record<NewsSourceKey, SourceConfig> {
  const next = createEmptyConfigMap();
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

  LITERATURE_TRIAGE_SOURCES.forEach((key) => {
    next[key] = normalizeSourceConfig(input[key]);
  });

  return next;
}

function normalizeResultsMap(raw: unknown): Record<NewsSourceKey, SearchResults> {
  const next = createEmptyResultsMap();
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

  LITERATURE_TRIAGE_SOURCES.forEach((key) => {
    next[key] = normalizeSearchResults(input[key]);
  });

  return next;
}

function hasSnapshotPayload(snapshot: NewsDashboardSnapshot) {
  return snapshot.sources.length > 0
    || LITERATURE_TRIAGE_SOURCES.some((key) => Object.keys(snapshot.configs[key] || {}).length > 0)
    || LITERATURE_TRIAGE_SOURCES.some((key) => snapshot.results[key]?.top_papers?.length > 0);
}

export function normalizeNewsDashboardSnapshot(raw: unknown): NewsDashboardSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Partial<CachedNewsDashboardSnapshot>;
  const snapshot: NewsDashboardSnapshot = {
    sources: normalizeSources(body.sources),
    configs: normalizeConfigMap(body.configs),
    results: normalizeResultsMap(body.results),
  };

  return hasSnapshotPayload(snapshot) ? snapshot : null;
}

export function readCachedNewsDashboardSnapshot(): NewsDashboardSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(NEWS_DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedNewsDashboardSnapshot>;
    if (parsed.version !== NEWS_DASHBOARD_CACHE_VERSION) return null;
    return normalizeNewsDashboardSnapshot(parsed);
  } catch {
    return null;
  }
}

function writeCachedNewsDashboardSnapshot(snapshot: NewsDashboardSnapshot) {
  if (typeof window === 'undefined' || !hasSnapshotPayload(snapshot)) return;

  try {
    const cached: CachedNewsDashboardSnapshot = {
      ...snapshot,
      version: NEWS_DASHBOARD_CACHE_VERSION,
      cachedAt: Date.now(),
    };
    window.localStorage.setItem(NEWS_DASHBOARD_CACHE_KEY, JSON.stringify(cached));
  } catch (error) {
    console.warn('Failed to cache news dashboard data:', error);
  }
}

async function responseJsonOrNull(response: Response) {
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function fetchNewsDashboardSnapshot(): Promise<NewsDashboardSnapshot> {
  const bootstrapBody = await api.news.getBootstrap()
    .then(responseJsonOrNull)
    .catch(() => null);
  const bootstrapSnapshot = normalizeNewsDashboardSnapshot(bootstrapBody);
  if (bootstrapSnapshot) return bootstrapSnapshot;

  const sourcesBody = await api.news.getSources().then(responseJsonOrNull).catch(() => null);
  const sources = normalizeSources(
    sourcesBody && typeof sourcesBody === 'object'
      ? (sourcesBody as { sources?: unknown }).sources
      : [],
  );

  const configPromises = LITERATURE_TRIAGE_SOURCES.map((key) =>
    api.news.getConfig(key).then((r) => r.json()).catch(() => ({}))
  );
  const resultPromises = LITERATURE_TRIAGE_SOURCES.map((key) =>
    api.news.getResults(key).then((r) => r.json()).catch(() => createEmptySearchResults())
  );

  const [cfgs, ress] = await Promise.all([
    Promise.all(configPromises),
    Promise.all(resultPromises),
  ]);

  const configs = createEmptyConfigMap();
  const results = createEmptyResultsMap();
  LITERATURE_TRIAGE_SOURCES.forEach((key, i) => {
    configs[key] = normalizeSourceConfig(cfgs[i]);
    results[key] = normalizeSearchResults(ress[i]);
  });

  return { sources, configs, results };
}

export function useNewsDashboardData() {
  const [initialSnapshot] = useState(() => readCachedNewsDashboardSnapshot());
  const [sources, setSources] = useState<SourceInfo[]>(() => initialSnapshot?.sources ?? []);
  const [configs, setConfigs] = useState<Record<NewsSourceKey, SourceConfig>>(() => initialSnapshot?.configs ?? createEmptyConfigMap());
  const [results, setResults] = useState<Record<NewsSourceKey, SearchResults>>(() => initialSnapshot?.results ?? createEmptyResultsMap());
  const [isSearching, setIsSearching] = useState<Record<NewsSourceKey, boolean>>({} as Record<NewsSourceKey, boolean>);
  const [errors, setErrors] = useState<Record<NewsSourceKey, string | null>>({} as Record<NewsSourceKey, string | null>);
  const [configDirty, setConfigDirty] = useState<Record<NewsSourceKey, boolean>>({} as Record<NewsSourceKey, boolean>);
  const [searchLogs, setSearchLogs] = useState<Record<NewsSourceKey, string[]>>({} as Record<NewsSourceKey, string[]>);
  const [isLoading, setIsLoading] = useState(() => !initialSnapshot);
  const sourcesRef = useRef(sources);
  const configsRef = useRef(configs);
  const resultsRef = useRef(results);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(() => {
    configsRef.current = configs;
  }, [configs]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const persistCurrentSnapshot = useCallback((overrides: Partial<NewsDashboardSnapshot> = {}) => {
    writeCachedNewsDashboardSnapshot({
      sources: overrides.sources ?? sourcesRef.current,
      configs: overrides.configs ?? configsRef.current,
      results: overrides.results ?? resultsRef.current,
    });
  }, []);

  // Hydrate instantly from the local snapshot, then refresh the server-side cache in the background.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const snapshot = await fetchNewsDashboardSnapshot();
        if (cancelled) return;
        setSources(snapshot.sources);
        setConfigs(snapshot.configs);
        setResults(snapshot.results);
        writeCachedNewsDashboardSnapshot(snapshot);
      } catch (err) {
        console.error('Failed to load news dashboard data:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Poll intermediate results while any source is searching
  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;

  useEffect(() => {
    const searchingKeys = LITERATURE_TRIAGE_SOURCES.filter((k) => isSearching[k]);
    if (searchingKeys.length === 0) return;

    const interval = setInterval(async () => {
      const currentSearching = LITERATURE_TRIAGE_SOURCES.filter((k) => isSearchingRef.current[k]);
      if (currentSearching.length === 0) return;

      await Promise.allSettled(
        currentSearching.map(async (key) => {
          try {
            // Poll intermediate results
            const resPromise = api.news.getResults(key);
            // Poll search logs
            const logPromise = api.news.getLogs(key);

            const [resResult, logResult] = await Promise.allSettled([resPromise, logPromise]);

            if (resResult.status === 'fulfilled' && resResult.value.ok) {
              const data = await resResult.value.json();
              const normalized = normalizeSearchResults(data);
              if (normalized.top_papers.length > 0) {
                setResults((prev) => {
                  const next = { ...prev, [key]: normalized };
                  persistCurrentSnapshot({ results: next });
                  return next;
                });
              }
            }

            if (logResult.status === 'fulfilled' && logResult.value.ok) {
              const logData = await logResult.value.json();
              if (logData?.logs?.length > 0) {
                setSearchLogs((prev) => ({ ...prev, [key]: logData.logs }));
              }
            }
          } catch {
            // ignore polling errors
          }
        })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, [isSearching, persistCurrentSnapshot]);

  const searchSource = useCallback(async (key: NewsSourceKey) => {
    setIsSearching((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));
    setSearchLogs((prev) => ({ ...prev, [key]: [] }));
    try {
      // Save config if dirty
      if (configDirty[key] && configs[key]) {
        await api.news.updateConfig(key, configs[key]);
        setConfigDirty((prev) => ({ ...prev, [key]: false }));
        persistCurrentSnapshot({ configs });
      }
      const res = await api.news.search(key);
      if (!res.ok) {
        const errData = await res.json();
        // Show logs from failed search if available
        if (errData.logs) {
          setSearchLogs((prev) => ({ ...prev, [key]: errData.logs }));
        }
        throw new Error(errData.error || 'Search failed');
      }
      const data = await res.json();
      // Capture logs returned with results
      if (data.logs) {
        setSearchLogs((prev) => ({ ...prev, [key]: data.logs }));
      }
      const normalized = normalizeSearchResults(data);
      setResults((prev) => {
        const next = { ...prev, [key]: normalized };
        persistCurrentSnapshot({ results: next });
        return next;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setIsSearching((prev) => ({ ...prev, [key]: false }));
    }
  }, [configs, configDirty, persistCurrentSnapshot]);

  const searchAll = useCallback(async (activeKeys: NewsSourceKey[]) => {
    await Promise.allSettled(activeKeys.map((key) => searchSource(key)));
  }, [searchSource]);

  const updateConfig = useCallback((key: NewsSourceKey, config: SourceConfig) => {
    setConfigs((prev) => ({ ...prev, [key]: config }));
    setConfigDirty((prev) => ({ ...prev, [key]: true }));
  }, []);

  const saveConfig = useCallback(async (key: NewsSourceKey) => {
    if (!configs[key]) return;
    try {
      await api.news.updateConfig(key, configs[key]);
      setConfigDirty((prev) => ({ ...prev, [key]: false }));
      persistCurrentSnapshot({ configs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save config';
      setErrors((prev) => ({ ...prev, [key]: message }));
    }
  }, [configs, persistCurrentSnapshot]);

  const resetConfig = useCallback(async (key: NewsSourceKey) => {
    try {
      const res = await api.news.resetConfig(key);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to reset config');
      }

      const data = await res.json();
      const nextConfig = data?.config || {};
      setConfigs((prev) => {
        const next = { ...prev, [key]: nextConfig };
        persistCurrentSnapshot({ configs: next });
        return next;
      });
      setConfigDirty((prev) => ({ ...prev, [key]: false }));
      setErrors((prev) => ({ ...prev, [key]: null }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reset config';
      setErrors((prev) => ({ ...prev, [key]: message }));
    }
  }, [persistCurrentSnapshot]);

  const clearError = useCallback((key: NewsSourceKey) => {
    setErrors((prev) => ({ ...prev, [key]: null }));
  }, []);

  const clearResults = useCallback((key: NewsSourceKey) => {
    setResults((prev) => {
      const next = { ...prev, [key]: createEmptySearchResults() };
      persistCurrentSnapshot({ results: next });
      return next;
    });
    setSearchLogs((prev) => ({ ...prev, [key]: [] }));
    setErrors((prev) => ({ ...prev, [key]: null }));
  }, [persistCurrentSnapshot]);

  return {
    sources,
    configs,
    results,
    isSearching,
    errors,
    configDirty,
    searchLogs,
    isLoading,
    searchSource,
    searchAll,
    updateConfig,
    saveConfig,
    resetConfig,
    clearError,
    clearResults,
  };
}
