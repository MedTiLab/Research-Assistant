import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectTokenUsageSummary } from '../project-dashboard/hooks/useProjectTokenUsageSummary';
import { formatTokenCount } from '../project-dashboard/utils/projectStats';

function TokenMetric({ label, value }) {
  return (
    <div className="rounded-xl border border-emerald-200/40 bg-emerald-50/25 p-4 shadow-sm dark:border-emerald-900/30 dark:bg-emerald-950/10">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700/70 dark:text-emerald-300/70">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold leading-none tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

export default function TokenUsageSettingsContent({ projects = [] }) {
  const { t } = useTranslation('settings');
  const tokenUsageSummary = useProjectTokenUsageSummary(projects);

  const projectRows = useMemo(() => (
    projects
      .map((project) => {
        const usage = tokenUsageSummary?.projects?.[project.name] || null;
        return {
          name: project.displayName || project.name,
          path: project.fullPath || project.path || '',
          todayTokens: usage?.todayTokens ?? null,
          weekTokens: usage?.weekTokens ?? null,
          sortValue: usage?.weekTokens ?? usage?.todayTokens ?? 0,
        };
      })
      .sort((a, b) => b.sortValue - a.sortValue || a.name.localeCompare(b.name))
  ), [projects, tokenUsageSummary]);

  const generatedAt = tokenUsageSummary?.generatedAt
    ? new Date(tokenUsageSummary.generatedAt).toLocaleString()
    : '';

  return (
    <div className="space-y-6">
      <div className="pl-1 md:pl-2">
        <h3 className="text-lg font-semibold leading-tight text-foreground">
          {t('tokenUsage.title')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('tokenUsage.description')}
        </p>
        {generatedAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('tokenUsage.generatedAt', { time: generatedAt })}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TokenMetric
          label={t('tokenUsage.todayTokens')}
          value={formatTokenCount(tokenUsageSummary?.workspace?.todayTokens)}
        />
        <TokenMetric
          label={t('tokenUsage.weekTokens')}
          value={formatTokenCount(tokenUsageSummary?.workspace?.weekTokens)}
        />
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <h4 className="text-sm font-semibold text-foreground">
            {t('tokenUsage.projectBreakdown')}
          </h4>
        </div>

        {projectRows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {t('tokenUsage.empty')}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {projectRows.map((row) => (
              <div key={`${row.name}:${row.path}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{row.name}</div>
                  {row.path && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.path}</div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {t('tokenUsage.todayTokens')}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                    {formatTokenCount(row.todayTokens)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {t('tokenUsage.weekTokens')}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                    {formatTokenCount(row.weekTokens)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
