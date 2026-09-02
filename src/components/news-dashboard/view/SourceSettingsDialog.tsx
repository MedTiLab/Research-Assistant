import {
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../ui/button';
import type { NewsSourceKey, ResearchDomain, SourceInfo } from './useNewsDashboardData';

const ARXIV_CATEGORIES = [
  'cs.AI', 'cs.CL', 'cs.CV', 'cs.IR', 'cs.LG',
  'eess.IV', 'q-bio.GN', 'q-bio.QM',
];

const SOURCE_TITLE_KEYS: Record<NewsSourceKey, string> = {
  pubmed: 'settings.pubmedTitle',
  europepmc: 'settings.europepmcTitle',
  medrxiv: 'settings.medrxivTitle',
  arxiv: 'settings.arxivTitle',
};

const MAX_RESULTS_LABEL_KEYS: Partial<Record<NewsSourceKey, string>> = {
  pubmed: 'settings.maxPubmedResults',
  europepmc: 'settings.maxEuropepmcResults',
  medrxiv: 'settings.maxMedrxivResults',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>;

function DomainEditor({
  name,
  domain,
  onUpdate,
  onRemove,
  showCategories,
}: {
  name: string;
  domain: ResearchDomain;
  onUpdate: (name: string, domain: ResearchDomain) => void;
  onRemove: (name: string) => void;
  showCategories?: boolean;
}) {
  const { t } = useTranslation('news');
  const [keywordInput, setKeywordInput] = useState('');
  const [catInput, setCatInput] = useState('');

  const addKeyword = () => {
    const keyword = keywordInput.trim();
    if (keyword && !domain.keywords.includes(keyword)) {
      onUpdate(name, { ...domain, keywords: [...domain.keywords, keyword] });
      setKeywordInput('');
    }
  };

  const removeKeyword = (keyword: string) => {
    onUpdate(name, { ...domain, keywords: domain.keywords.filter((entry) => entry !== keyword) });
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3 transition-colors hover:border-border/80">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{name}</h4>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-muted-foreground">{t('settings.priority')}</label>
            <input
              type="number"
              min={1}
              max={10}
              value={domain.priority}
              onChange={(e) => onUpdate(name, { ...domain, priority: parseInt(e.target.value, 10) || 5 })}
              className="w-12 rounded-lg border border-border/60 bg-background px-2 py-1 text-xs text-center font-medium tabular-nums"
            />
          </div>
          <button onClick={() => onRemove(name)} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.keywords')}</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {domain.keywords.map((keyword) => (
            <span key={keyword} className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-medium text-primary">
              {keyword}
              <button onClick={() => removeKeyword(keyword)} className="text-primary/60 hover:text-destructive transition-colors">&times;</button>
            </span>
          ))}
          <div className="inline-flex items-center gap-1">
            <input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
              placeholder={t('settings.addPlaceholder')}
              className="w-24 rounded-lg border border-dashed border-border/60 bg-transparent px-2 py-0.5 text-[10px] placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
            />
            <button onClick={addKeyword} className="rounded p-0.5 text-primary/60 hover:text-primary transition-colors"><Plus className="h-3 w-3" /></button>
          </div>
        </div>
      </div>

      {showCategories && (
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.arxivCategories')}</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {domain.arxiv_categories.map((category) => (
              <span key={category} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200/60 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                {category}
                <button onClick={() => onUpdate(name, { ...domain, arxiv_categories: domain.arxiv_categories.filter((entry) => entry !== category) })} className="text-emerald-400 hover:text-destructive transition-colors">&times;</button>
              </span>
            ))}
            <select
              value={catInput}
              onChange={(e) => {
                const category = e.target.value;
                if (category && !domain.arxiv_categories.includes(category)) {
                  onUpdate(name, { ...domain, arxiv_categories: [...domain.arxiv_categories, category] });
                }
                setCatInput('');
              }}
              className="rounded-lg border border-dashed border-border/60 bg-transparent px-2 py-0.5 text-[10px] text-muted-foreground/70 focus:border-primary/40 focus:outline-none"
            >
              <option value="">{t('settings.addPlaceholder')}</option>
              {ARXIV_CATEGORIES.filter((category) => !domain.arxiv_categories.includes(category)).map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SourceSettingsDialog({
  sourceKey,
  config,
  onConfigChange,
  onSave,
  onReset,
  onClose,
  sourceInfo: _sourceInfo,
  configDirty,
}: {
  sourceKey: NewsSourceKey;
  config: AnyConfig;
  onConfigChange: (config: AnyConfig) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  sourceInfo?: SourceInfo;
  configDirty: boolean;
}) {
  const { t } = useTranslation('news');
  const [newDomainName, setNewDomainName] = useState('');

  const updateField = useCallback((field: string, value: unknown) => {
    onConfigChange({ ...config, [field]: value });
  }, [config, onConfigChange]);

  const updateDomain = useCallback((name: string, domain: ResearchDomain) => {
    onConfigChange({ ...config, research_domains: { ...(config.research_domains || {}), [name]: domain } });
  }, [config, onConfigChange]);

  const removeDomain = useCallback((name: string) => {
    const domains = { ...(config.research_domains || {}) };
    delete domains[name];
    onConfigChange({ ...config, research_domains: domains });
  }, [config, onConfigChange]);

  const addDomain = useCallback(() => {
    const name = newDomainName.trim();
    if (!name) return;
    onConfigChange({
      ...config,
      research_domains: {
        ...(config.research_domains || {}),
        [name]: {
          keywords: [],
          arxiv_categories: sourceKey === 'arxiv' ? ['q-bio.QM'] : [],
          priority: 5,
        },
      },
    });
    setNewDomainName('');
  }, [config, newDomainName, onConfigChange, sourceKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[28px] border border-border/60 bg-card p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <Settings2 className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{t(SOURCE_TITLE_KEYS[sourceKey])}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full text-xs"
              onClick={onReset}
            >
              {t('actions.resetDefaults')}
            </Button>
            {configDirty && (
              <Button size="sm" className="rounded-full text-xs gap-1.5 shadow-sm" onClick={onSave}>
                {t('actions.save')}
              </Button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className={`grid gap-4 ${sourceKey === 'arxiv' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.resultsToShow')}</label>
            <input
              type="number"
              min={1}
              max={50}
              value={config.top_n || 10}
              onChange={(e) => updateField('top_n', parseInt(e.target.value, 10) || 10)}
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>

          {sourceKey === 'arxiv' && (
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.maxArxivResults')}</label>
              <input
                type="number"
                min={50}
                max={1000}
                step={50}
                value={config.max_results || 200}
                onChange={(e) => updateField('max_results', parseInt(e.target.value, 10) || 200)}
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
          )}

          {(sourceKey === 'pubmed' || sourceKey === 'europepmc' || sourceKey === 'medrxiv') && (
            <>
              <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t(MAX_RESULTS_LABEL_KEYS[sourceKey] ?? 'settings.resultsToShow')}</label>
                <input
                  type="number"
                  min={20}
                  max={300}
                  step={10}
                  value={config.max_results || (sourceKey === 'medrxiv' ? 150 : 120)}
                  onChange={(e) => updateField('max_results', parseInt(e.target.value, 10) || (sourceKey === 'medrxiv' ? 150 : 120))}
                  className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
              </div>
              <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.dateRangeDays')}</label>
                <input
                  type="number"
                  min={7}
                  max={365}
                  step={1}
                  value={config.date_range_days || 30}
                  onChange={(e) => updateField('date_range_days', parseInt(e.target.value, 10) || 30)}
                  className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
              </div>
            </>
          )}
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.researchDomains')}</label>
          {Object.entries(config.research_domains || {}).map(([name, domain]) => (
            <DomainEditor
              key={name}
              name={name}
              domain={domain as ResearchDomain}
              onUpdate={updateDomain}
              onRemove={removeDomain}
              showCategories={sourceKey === 'arxiv'}
            />
          ))}
          <div className="flex items-center gap-2">
            <input
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDomain()}
              placeholder={t('settings.newDomainPlaceholder')}
              className="flex-1 rounded-xl border border-dashed border-border/60 bg-transparent px-3.5 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
            />
            <Button size="sm" variant="outline" className="rounded-full gap-1.5" onClick={addDomain} disabled={!newDomainName.trim()}>
              <Plus className="h-3.5 w-3.5" /> {t('settings.addDomain')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
