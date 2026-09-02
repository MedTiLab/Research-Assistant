import {
  Loader2,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../ui/button';
import SourceIcon from './SourceIcon';
import { LITERATURE_TRIAGE_SOURCES, type NewsSourceKey, type SourceInfo } from './useNewsDashboardData';

const SOURCE_LABEL_KEYS: Record<NewsSourceKey, string> = {
  pubmed: 'sources.pubmed',
  europepmc: 'sources.europepmc',
  medrxiv: 'sources.medrxiv',
  arxiv: 'sources.arxiv',
  wechat: 'sources.wechatShort',
  xiaohongshu: 'sources.xiaohongshu',
};

export default function SourceFilterBar({
  activeSource,
  onSelectSource,
  sources,
  isSearching,
  onSearch,
  isSearchingActive,
}: {
  activeSource: NewsSourceKey;
  onSelectSource: (key: NewsSourceKey) => void;
  sources: SourceInfo[];
  isSearching: Record<NewsSourceKey, boolean>;
  onSearch: () => void;
  isSearchingActive: boolean;
}) {
  const { t } = useTranslation('news');

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-xl bg-muted/70 p-1 dark:bg-muted/40">
      {LITERATURE_TRIAGE_SOURCES.map((key) => {
        const label = t(SOURCE_LABEL_KEYS[key]);
        const isActive = activeSource === key;
        const info = sources.find((s) => s.key === key);
        const needsCred = info?.requiresCredentials && info.credentialStatus === 'missing';
        const searching = isSearching[key];

        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelectSource(key)}
            className={`relative flex min-h-8 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
              isActive
                ? 'bg-white text-foreground shadow-sm ring-1 ring-border/70 dark:bg-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {searching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <SourceIcon sourceKey={key} className="h-3 w-3" />
            )}
            <span className="whitespace-nowrap">{label}</span>
            {needsCred && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" title={t('settings.credentialRequired')} />
            )}
          </button>
        );
      })}

      <div className="ml-auto">
        <Button
          onClick={onSearch}
          disabled={isSearchingActive}
          className="h-8 gap-1 rounded-lg bg-background px-2.5 text-[11px] text-foreground shadow-sm hover:bg-background/85"
          size="sm"
          variant="outline"
        >
          {isSearchingActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          {t('actions.searchAll')}
        </Button>
      </div>
    </div>
  );
}
