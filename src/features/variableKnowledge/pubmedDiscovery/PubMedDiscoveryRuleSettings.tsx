import { CalendarClock, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { getPublicDatabaseLabels } from '../../../../shared/publicDatabaseCatalog';
import { PUBMED_VARIABLE_EXTRACTION_PROMPT_VERSION } from '../../../../shared/pubmedVariableDiscoveryPrompt';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { RuleSettings } from './types';

const DATABASE_OPTIONS = getPublicDatabaseLabels();

const DEFAULT_RULES: RuleSettings = {
  frequency: 'weekly',
  dailyRunTime: '08:00',
  weeklyRunDay: '周一',
  weeklyRunTime: '08:00',
  scopes: ['公共数据库文献', '队列研究', '风险评分', '联合指标', '新指标'],
  databaseKeywords: ['NHANES', 'UK Biobank', 'CHARLS', 'MIMIC-IV', 'eICU-CRD', 'CHNS', 'CLHLS'],
  minimumConfidence: 0.6,
  autoAddToCandidatePool: false,
  autoMergeMatchedEvidence: true,
};

const SCOPE_OPTIONS = ['公共数据库文献', '队列研究', '风险评分', '联合指标', '新指标'];

export default function PubMedDiscoveryRuleSettings({
  variant = 'page',
  onSaveSuccess,
}: {
  variant?: 'page' | 'dropdown';
  onSaveSuccess?: () => void;
} = {}) {
  const [rules, setRules] = useState<RuleSettings>(DEFAULT_RULES);
  const [saved, setSaved] = useState(false);

  const toggleListItem = (key: 'scopes' | 'databaseKeywords', value: string) => {
    setRules((prev) => {
      const current = new Set(prev[key]);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      return { ...prev, [key]: Array.from(current) };
    });
  };

  return (
    <section
      className={cn(
        variant === 'page'
          ? 'rounded-2xl border border-border/60 bg-card/80 shadow-sm dark:bg-slate-950/45'
          : 'rounded-xl border-0 bg-transparent shadow-none',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-foreground">规则设置</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">配置自动发现频率、检索范围、数据库关键词与审核阈值。</p>
        </div>
        <Button
          type="button"
          className="h-9 rounded-xl border border-slate-300 bg-slate-500 text-white hover:bg-slate-600 dark:border-slate-600 dark:bg-slate-400 dark:text-slate-900 dark:hover:bg-slate-300"
          onClick={() => {
            setSaved(true);
            onSaveSuccess?.();
          }}
        >
          保存设置
        </Button>
      </div>

      <div className="grid gap-4 border-t border-border/50 p-4 sm:p-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              <p className="text-sm font-semibold text-foreground">运行频率</p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                自动发现频率
                <select
                  className="mt-1 h-9 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                  value={rules.frequency}
                  onChange={(event) => setRules((prev) => ({ ...prev, frequency: event.target.value as RuleSettings['frequency'] }))}
                >
                  <option value="daily">每日</option>
                  <option value="weekly">每周</option>
                  <option value="off">关闭</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                每日运行时间
                <input
                  className="mt-1 h-9 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                  value={rules.dailyRunTime}
                  onChange={(event) => setRules((prev) => ({ ...prev, dailyRunTime: event.target.value }))}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                每周运行日
                <select
                  className="mt-1 h-9 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                  value={rules.weeklyRunDay}
                  onChange={(event) => setRules((prev) => ({ ...prev, weeklyRunDay: event.target.value }))}
                >
                  {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                每周运行时间
                <input
                  className="mt-1 h-9 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                  value={rules.weeklyRunTime}
                  onChange={(event) => setRules((prev) => ({ ...prev, weeklyRunTime: event.target.value }))}
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
            <p className="text-sm font-semibold text-foreground">置信度与自动化</p>
            <label className="mt-3 block text-xs text-muted-foreground">
              最低置信度阈值：{rules.minimumConfidence.toFixed(2)}
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={rules.minimumConfidence}
                onChange={(event) => setRules((prev) => ({ ...prev, minimumConfidence: Number(event.target.value) }))}
                className="mt-2 w-full accent-slate-500"
              />
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-border"
                checked={rules.autoAddToCandidatePool}
                onChange={(event) => setRules((prev) => ({ ...prev, autoAddToCandidatePool: event.target.checked }))}
              />
              是否自动加入候选池（默认关闭）
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-border"
                checked={rules.autoMergeMatchedEvidence}
                onChange={(event) => setRules((prev) => ({ ...prev, autoMergeMatchedEvidence: event.target.checked }))}
              />
              已匹配且置信度 ≥ 0.85 时自动合并证据
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
            <p className="text-sm font-semibold text-foreground">检索范围</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCOPE_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    rules.scopes.includes(item)
                      ? 'border-slate-200/80 bg-slate-50/90 text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/30 dark:text-slate-100'
                      : 'border-border/60 bg-muted/35 text-muted-foreground'
                  }`}
                  onClick={() => toggleListItem('scopes', item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
            <p className="text-sm font-semibold text-foreground">数据库关键词</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DATABASE_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    rules.databaseKeywords.includes(item)
                      ? 'border-slate-200/80 bg-slate-50/90 text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/30 dark:text-slate-100'
                      : 'border-border/60 bg-muted/35 text-muted-foreground'
                  }`}
                  onClick={() => toggleListItem('databaseKeywords', item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
            <p className="text-sm font-semibold text-foreground">Claude JSON 提取提示词</p>
            <div className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              <p>版本：{PUBMED_VARIABLE_EXTRACTION_PROMPT_VERSION}</p>
              <p>执行：立即运行优先启动系统内置 Claude/LLM 做 JSON 抽取；只有模型不可用时才进入规则预抽取兜底。</p>
              <p>输出：严格 JSON，字段覆盖 PMID、变量名、中文名、类型、数据库家族、证据句、置信度与审核状态。</p>
              <p>排除：odds ratio、hazard ratio、confidence interval、p value、死亡/生存期等结局终点、标题片段与泛化 predictor/biomarker。</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/60 bg-slate-50/70 px-3 py-3 text-sm leading-6 text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/20 dark:text-slate-100">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>自动调度待后端启用；当前版本支持「立即运行」与本地规则保存状态。自动加入正式 stable 变量库被禁止。</p>
            </div>
          </div>

          {saved ? (
            <div className="rounded-xl border border-slate-200/50 bg-slate-50/80 px-3 py-2 text-sm text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/20 dark:text-slate-100">
              设置已保存在当前页面状态中，等待后端规则 API 接入。
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
