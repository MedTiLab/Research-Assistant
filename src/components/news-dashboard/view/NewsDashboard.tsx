import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../../types/app';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';

import { ExplorerPage, explorerItemClass } from '../../explorer/ExplorerPage';
import SourceSettingsDialog from './SourceSettingsDialog';
import UnifiedFeed from './UnifiedFeed';
import { useNewsDashboardData, LITERATURE_HERO_STAT_SOURCES, LITERATURE_TRIAGE_SOURCES } from './useNewsDashboardData';
import type { NewsSourceKey } from './useNewsDashboardData';

const SOURCE_LABEL_KEYS: Record<NewsSourceKey, string> = {
  pubmed: 'sources.pubmed',
  europepmc: 'sources.europepmc',
  medrxiv: 'sources.medrxiv',
  arxiv: 'sources.arxiv',
  wechat: 'sources.wechatShort',
  xiaohongshu: 'sources.xiaohongshu',
};

type NewsDashboardProps = {
  chatTargetProject?: Project | null;
  onStartResearchPrompt?: (project: Project, prompt: string | ChatPromptDraft) => void;
};

function NewsMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex min-h-[68px] flex-col items-center justify-center rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5 text-center shadow-sm dark:bg-muted/20">
      <span className="text-[10px] font-medium uppercase leading-4 tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 text-[15px] font-semibold leading-none tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

export default function NewsDashboard({
  chatTargetProject = null,
  onStartResearchPrompt,
}: NewsDashboardProps) {
  const { t } = useTranslation('news');
  const {
    sources,
    configs,
    results,
    isSearching,
    errors,
    configDirty,
    searchLogs,
    isLoading,
    searchSource,
    updateConfig,
    saveConfig,
    resetConfig,
    clearResults,
  } = useNewsDashboardData();

  const [activeSource, setActiveSource] = useState<NewsSourceKey>('pubmed');
  const [settingsSource, setSettingsSource] = useState<NewsSourceKey | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('card');

  const handleSearch = useCallback(() => {
    searchSource(activeSource);
  }, [searchSource, activeSource]);

  const isSearchingActive = isSearching[activeSource];

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary/60" />
        <span className="text-sm text-muted-foreground">{t('status.loading')}</span>
      </div>
    );
  }

  return (
    <>
    <ExplorerPage
      eyebrow="Literature"
      title={t('hero.title')}
      countLabel={`${LITERATURE_TRIAGE_SOURCES.length}`}
      sidebar={LITERATURE_TRIAGE_SOURCES.map((key) => {
        const info = sources.find((source) => source.key === key);
        return (
          <button key={key} type="button" onClick={() => setActiveSource(key)} className={explorerItemClass(activeSource === key)}>
            <span className="min-w-0 truncate">{t(SOURCE_LABEL_KEYS[key])}</span>
            <span className="text-xs font-normal text-muted-foreground">{results[key]?.top_papers?.length ?? 0}</span>
            {info?.requiresCredentials && info.credentialStatus === 'missing' ? (
              <span className="text-[10px] font-normal text-amber-700">!</span>
            ) : null}
          </button>
        );
      })}
      resultsEyebrow={t('hero.title')}
      resultsTitle={t(SOURCE_LABEL_KEYS[activeSource])}
      resultsDescription={chatTargetProject
        ? t('hero.chatTarget', { project: chatTargetProject.displayName || chatTargetProject.name })
        : t('hero.selectProjectHint')}
      resultsActions={(
        <button
          type="button"
          onClick={handleSearch}
          disabled={isSearchingActive}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {isSearchingActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t('hero.compactDescription')}
        </button>
      )}
    >
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LITERATURE_HERO_STAT_SOURCES.map((key) => (
            <NewsMetric
              key={key}
              label={t(SOURCE_LABEL_KEYS[key])}
              value={results[key]?.top_papers?.length ?? 0}
            />
          ))}
        </div>
        <UnifiedFeed
          activeSource={activeSource}
          viewMode={viewMode}
          results={results}
          errors={errors}
          isSearching={isSearching}
          searchLogs={searchLogs}
          chatTargetProject={chatTargetProject}
          onStartResearchPrompt={onStartResearchPrompt}
          onSearchSource={searchSource}
          onOpenSettings={setSettingsSource}
          onClearSource={clearResults}
          onViewModeChange={setViewMode}
        />
      </div>
    </ExplorerPage>
      {settingsSource && configs[settingsSource] ? (
        <SourceSettingsDialog
          sourceKey={settingsSource}
          config={configs[settingsSource]}
          onConfigChange={(cfg) => updateConfig(settingsSource, cfg)}
          onSave={() => saveConfig(settingsSource)}
          onReset={() => resetConfig(settingsSource)}
          onClose={() => setSettingsSource(null)}
          sourceInfo={sources.find((source) => source.key === settingsSource)}
          configDirty={configDirty[settingsSource] ?? false}
        />
      ) : null}
    </>
  );
}
