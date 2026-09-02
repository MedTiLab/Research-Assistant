import { ChevronDown, PlayCircle, RotateCcw, Search, SlidersHorizontal, StopCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import PubMedDiscoveryRuleSettings from './PubMedDiscoveryRuleSettings';
import type { VariableCandidateMatchStatus, VariableType } from './types';
import type { CandidateFilters } from './utils';
import { MATCH_STATUS_LABELS, VARIABLE_TYPE_LABELS } from './utils';

type Props = {
  filters: CandidateFilters;
  databaseFamilies: string[];
  clinicalDomains: string[];
  isRunning: boolean;
  advancedOpen: boolean;
  ruleSettingsOpen: boolean;
  onFiltersChange: (filters: CandidateFilters) => void;
  onRun: () => void;
  onCancel: () => void;
  onReset: () => void;
  onToggleAdvanced: () => void;
  onRuleSettingsOpenChange: (open: boolean) => void;
};

const VARIABLE_TYPES: Array<'all' | VariableType> = ['all', 'raw_field', 'derived_index', 'risk_score', 'covariate', 'stratifier'];
const MATCH_STATUSES: Array<'all' | VariableCandidateMatchStatus> = ['all', 'new', 'matched', 'ambiguous', 'manual_review', 'ignored', 'added_to_candidate_pool', 'merged'];

export default function PubMedDiscoveryFilters({
  filters,
  databaseFamilies,
  clinicalDomains,
  isRunning,
  advancedOpen,
  ruleSettingsOpen,
  onFiltersChange,
  onRun,
  onCancel,
  onReset,
  onToggleAdvanced,
  onRuleSettingsOpenChange,
}: Props) {
  const rulesWrapRef = useRef<HTMLDivElement>(null);

  const patchFilters = (patch: Partial<CandidateFilters>) => {
    onFiltersChange({ ...filters, ...patch });
  };

  useEffect(() => {
    if (!ruleSettingsOpen) return;
    const onDocPointer = (event: PointerEvent) => {
      const node = rulesWrapRef.current;
      if (node && !node.contains(event.target as Node)) {
        onRuleSettingsOpenChange(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onRuleSettingsOpenChange(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ruleSettingsOpen, onRuleSettingsOpenChange]);

  return (
    <section className="space-y-3 border-b border-border/60 pb-4">
      <div className="grid items-center gap-3 xl:grid-cols-[minmax(260px,1.25fr)_auto_auto_auto]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(event) => patchFilters({ search: event.target.value })}
            placeholder="指定变量名或搜索候选 / PMID / 关键词…"
            className="h-10 border-border/60 bg-background pl-9"
          />
        </div>

        <div className="inline-flex items-center gap-2 self-center">
          {(['daily', 'weekly'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={cn(
                'inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors',
                filters.frequency === key
                  ? 'border-border bg-foreground text-background shadow-sm'
                  : 'border-border/70 bg-background text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
              )}
              onClick={() => patchFilters({ frequency: key })}
            >
              {key === 'daily' ? '🌞 每日' : '📅 每周'}
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant={isRunning ? 'destructive' : 'secondary'}
          className={cn(
            'h-10 px-3',
            !isRunning && 'border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-100 dark:hover:bg-slate-800',
          )}
          onClick={isRunning ? onCancel : onRun}
        >
          {isRunning ? <StopCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
          {isRunning ? '暂停运行' : '立即运行'}
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="h-10 px-3" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
            重置
          </Button>
          <Button
            type="button"
            variant={advancedOpen ? 'secondary' : 'outline'}
            className="h-10 px-3"
            onClick={onToggleAdvanced}
          >
            <SlidersHorizontal className="h-4 w-4" />
            高级设置
          </Button>
          <div className="relative" ref={rulesWrapRef}>
            <button
              type="button"
              aria-expanded={ruleSettingsOpen}
              aria-haspopup="dialog"
              className={cn(
                'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-colors',
                ruleSettingsOpen
                  ? 'bg-foreground text-background shadow-sm ring-1 ring-border'
                  : 'bg-muted/80 text-foreground/80 hover:bg-muted hover:text-foreground',
              )}
              onClick={() => onRuleSettingsOpenChange(!ruleSettingsOpen)}
            >
              规则设置
              <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', ruleSettingsOpen && 'rotate-180')} />
            </button>
            {ruleSettingsOpen ? (
              <div
                className="absolute right-0 z-50 mt-2 w-[min(100vw-1.5rem,36rem)] max-h-[min(85vh,40rem)] overflow-y-auto rounded-2xl border border-border/60 bg-card/95 p-2 shadow-lg backdrop-blur-sm dark:bg-slate-950/95"
                role="dialog"
                aria-label="规则设置"
              >
                <PubMedDiscoveryRuleSettings
                  variant="dropdown"
                  onSaveSuccess={() => {
                    window.setTimeout(() => onRuleSettingsOpenChange(false), 720);
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-1 grid items-center gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={filters.databaseFamily}
          onChange={(event) => patchFilters({ databaseFamily: event.target.value })}
        >
          <option value="all">数据库家族：全部公共数据库</option>
          {databaseFamilies.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>

        <select
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={filters.variableType}
          onChange={(event) => patchFilters({ variableType: event.target.value as CandidateFilters['variableType'] })}
        >
          {VARIABLE_TYPES.map((item) => (
            <option key={item} value={item}>{item === 'all' ? '变量类型：全部' : VARIABLE_TYPE_LABELS[item]}</option>
          ))}
        </select>

        <select
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={filters.clinicalDomain}
          onChange={(event) => patchFilters({ clinicalDomain: event.target.value })}
        >
          <option value="all">临床领域：全部</option>
          {clinicalDomains.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>

        <select
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={filters.matchStatus}
          onChange={(event) => patchFilters({ matchStatus: event.target.value as CandidateFilters['matchStatus'] })}
        >
          {MATCH_STATUSES.map((item) => (
            <option key={item} value={item}>{item === 'all' ? '匹配状态：全部' : MATCH_STATUS_LABELS[item]}</option>
          ))}
        </select>
      </div>

      {advancedOpen ? (
        <div className="mt-2 border-l-2 border-dashed border-border/70 pl-3 text-xs leading-5 text-muted-foreground">
          高级设置已展开：当前版本先支持变量、PMID、数据库、类型、领域和匹配状态过滤；后续可接入 PMID 去重、置信度阈值、期刊类型和研究设计过滤。
        </div>
      ) : null}
    </section>
  );
}
