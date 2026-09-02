import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FlaskConical,
  Loader2,
  Star,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import type { NewsSourceKey } from './useNewsDashboardData';

export type NewsItem = {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  published: string;
  categories: string[];
  relevance_score: number;
  recency_score: number;
  popularity_score: number;
  quality_score: number;
  final_score: number;
  matched_domain: string;
  matched_keywords: string[];
  link?: string;
  pdf_link?: string;
  source?: string;
};

export type NewsItemCardVariant = 'list' | 'card';

function ScoreBar({ label, score, max = 3, barClass, dotClass }: { label: string; score: number; max?: number; barClass: string; dotClass: string }) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <span className="flex items-center gap-1.5 w-[6.25rem] text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {label}
      </span>
      <div className="flex-1 h-[5px] rounded-full bg-muted/60 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-medium tabular-nums text-foreground/70">{score.toFixed(1)}</span>
    </div>
  );
}

function buildResearchPrompt(item: NewsItem, sourceKey: NewsSourceKey) {
  const lines: string[] = [
    'Please help me turn this newly discovered paper into an actionable research entry for the current project.',
    'Use the attached News Context as the primary citation context, and incorporate the newly added seed-paper / knowledge-base entry when framing the answer.',
    '',
    'Tasks:',
    '1. Summarize the core problem the paper addresses.',
    '2. Propose 3-5 follow-up research questions grounded in this paper.',
    '3. Explain how this paper could inform our current project or pipeline.',
    '4. Suggest whether it belongs primarily in Literature, Ideation, or Experiment.',
    '5. Draft a short structured note that could be saved under Literature/reports/ or attached to the research brief.',
    '',
    '[Paper Context]',
    `Source: ${sourceKey}`,
    `Title: ${item.title}`,
  ];

  if (item.authors) {
    lines.push(`Authors: ${item.authors}`);
  }
  if (item.published) {
    lines.push(`Published: ${item.published}`);
  }
  if (item.categories?.length) {
    lines.push(`Categories: ${item.categories.join(', ')}`);
  }
  if (item.matched_domain) {
    lines.push(`Matched domain: ${item.matched_domain}`);
  }
  if (item.matched_keywords?.length) {
    lines.push(`Matched keywords: ${item.matched_keywords.join(', ')}`);
  }
  if (item.link) {
    lines.push(`URL: ${item.link}`);
  }
  if (item.pdf_link) {
    lines.push(`PDF: ${item.pdf_link}`);
  }
  if (item.abstract) {
    lines.push('', 'Abstract:', item.abstract);
  }

  return lines.join('\n');
}

function buildNewsAttachedPrompt(
  item: NewsItem,
  sourceKey: NewsSourceKey,
  ingestResult?: {
    relativePath?: string;
    briefPath?: string;
    seedPaperCitation?: string;
  } | null,
) {
  const lines: string[] = ['[News Context]'];
  lines.push(`Source: ${sourceKey}`);
  lines.push(`Title: ${item.title}`);

  if (item.authors) {
    lines.push(`Authors: ${item.authors}`);
  }
  if (item.published) {
    lines.push(`Published: ${item.published}`);
  }
  if (item.link) {
    lines.push(`URL: ${item.link}`);
  }
  if (item.pdf_link) {
    lines.push(`PDF: ${item.pdf_link}`);
  }
  if (item.matched_domain) {
    lines.push(`Matched domain: ${item.matched_domain}`);
  }
  if (item.matched_keywords?.length) {
    lines.push(`Matched keywords: ${item.matched_keywords.join(', ')}`);
  }
  if (ingestResult?.seedPaperCitation) {
    lines.push(`Seed paper entry: ${ingestResult.seedPaperCitation}`);
  }
  if (ingestResult?.briefPath) {
    lines.push(`Research brief path: ${ingestResult.briefPath}`);
  }
  if (ingestResult?.relativePath) {
    lines.push(`Knowledge base note: ${ingestResult.relativePath}`);
  }
  if (item.abstract) {
    lines.push('', 'Abstract:', item.abstract);
  }

  return {
    scenarioId: 'news-paper-context',
    scenarioIcon: '📰',
    scenarioTitle: 'News Paper Context',
    promptText: lines.join('\n'),
  };
}

export default function NewsItemCard({
  item,
  index,
  sourceKey,
  variant = 'list',
  chatTargetProject,
  onStartResearchPrompt,
}: {
  item: NewsItem;
  index: number;
  sourceKey: NewsSourceKey;
  variant?: NewsItemCardVariant;
  chatTargetProject?: Project | null;
  onStartResearchPrompt?: (project: Project, prompt: string | ChatPromptDraft) => void;
}) {
  const { t } = useTranslation('news');
  const [expanded, setExpanded] = useState(false);
  const [isStartingResearch, setIsStartingResearch] = useState(false);

  const isTopItem = index < 3;
  const accentClass = isTopItem
    ? 'bg-primary'
    : 'bg-slate-300 dark:bg-slate-700';

  const arxivId = item.id?.replace(/^https?:\/\/arxiv\.org\/abs\//, '') ?? '';
  const primaryUrl =
    item.link ||
    (sourceKey === 'arxiv'
      ? `https://arxiv.org/abs/${arxivId}`
      : sourceKey === 'pubmed'
        ? `https://pubmed.ncbi.nlm.nih.gov/${item.id}/`
        : '#');
  const pdfUrl = item.pdf_link || (sourceKey === 'arxiv' ? `https://arxiv.org/pdf/${arxivId}` : null);
  const sourceBadgeLabel = t(`sources.${sourceKey}`);
  const canStartResearch = Boolean(chatTargetProject && onStartResearchPrompt);

  const handleStartResearch = async () => {
    if (!chatTargetProject || !onStartResearchPrompt) {
      return;
    }

    setIsStartingResearch(true);
    let ingestResult = null;

    try {
      const response = await api.taskmaster.ingestNewsItem(chatTargetProject.name, {
        item,
        sourceKey,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }

      ingestResult = await response.json();
      if (typeof window !== 'undefined' && ingestResult?.literatureReferenceId) {
        window.dispatchEvent(
          new CustomEvent('references-library-updated', {
            detail: {
              projectName: chatTargetProject.name,
              referenceId: ingestResult.literatureReferenceId,
            },
          }),
        );
      }
    } catch (error) {
      console.error('Failed to prepare news item for project analysis:', error);
    } finally {
      setIsStartingResearch(false);
    }

    onStartResearchPrompt(chatTargetProject, {
      input: buildResearchPrompt(item, sourceKey),
      attachedPrompt: buildNewsAttachedPrompt(item, sourceKey, ingestResult),
    });
  };

  const SCORE_COLORS = [
    { label: t('card.relevance'), key: 'relevance_score' as const, bar: 'bg-gradient-to-r from-cyan-500 to-sky-600', dot: 'bg-cyan-600' },
    { label: t('card.recency'), key: 'recency_score' as const, bar: 'bg-gradient-to-r from-teal-500 to-emerald-600', dot: 'bg-teal-600' },
    { label: t('card.popularity'), key: 'popularity_score' as const, bar: 'bg-gradient-to-r from-slate-500 to-slate-700', dot: 'bg-slate-600' },
    { label: t('card.quality'), key: 'quality_score' as const, bar: 'bg-gradient-to-r from-blue-500 to-indigo-600', dot: 'bg-blue-600' },
  ];
  const hasPrimaryUrl = Boolean(primaryUrl && primaryUrl !== '#');
  const compactCategories = item.categories?.slice(0, 2) ?? [];
  const compactKeywords = item.matched_keywords?.slice(0, 1) ?? [];
  const isCardView = variant === 'card';
  const secondaryButtonClass = 'inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60';
  const primaryButtonClass = 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45';

  const scoreBadge = (
    <div className={`rounded-xl border px-3 py-3 ${
      isTopItem
        ? 'border-primary/30 bg-primary/[0.08]'
        : 'border-border/60 bg-slate-50/80 dark:bg-slate-900/40'
    }`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        #{index + 1}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Star className="h-3.5 w-3.5 text-primary" fill="currentColor" />
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {item.final_score?.toFixed(1) ?? '—'}
        </span>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('card.final')}
      </div>
    </div>
  );

  const metaBadges = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="rounded-md border border-primary/30 bg-primary/[0.08] px-2 py-1 text-[10px] font-medium text-primary">
        {sourceBadgeLabel}
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
        <Clock className="h-3 w-3" />
        {item.published ? item.published.slice(0, 10) : '—'}
      </span>
      {item.matched_domain && (
        <span className="rounded-md border border-teal-200/70 bg-teal-50/80 px-2 py-1 text-[10px] font-medium text-teal-800 dark:border-teal-800/50 dark:bg-teal-950/25 dark:text-teal-200">
          {item.matched_domain}
        </span>
      )}
      {compactCategories.map((category) => (
        <span
          key={category}
          className="rounded-md border border-border/50 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground"
        >
          {category}
        </span>
      ))}
      {compactKeywords.map((keyword) => (
        <span
          key={keyword}
          className="rounded-md border border-primary/30 bg-primary/[0.07] px-2 py-0.5 text-[10px] font-medium text-primary"
        >
          {keyword}
        </span>
      ))}
    </div>
  );

  const actionButtons = (
    <>
      <button
        type="button"
        onClick={handleStartResearch}
        disabled={!canStartResearch || isStartingResearch}
        title={
          canStartResearch
            ? t('actions.researchFromPaper')
            : t('actions.selectProjectFirst')
        }
        className={primaryButtonClass}
      >
        <FlaskConical className="h-3 w-3" />
        {isStartingResearch ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        <span>{t('actions.researchFromPaper')}</span>
      </button>

      {hasPrimaryUrl && (
        <a
          href={primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={secondaryButtonClass}
        >
          {sourceBadgeLabel}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={secondaryButtonClass}
        >
          {t('card.pdf')}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={secondaryButtonClass}
      >
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {expanded ? t('card.showLess') : t('card.showMore')}
      </button>
    </>
  );

  const expandedContent = (
    <div className="border-t border-border/50 bg-slate-50/60 px-4 py-4 dark:bg-slate-950/30">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.95fr)]">
        <div className="rounded-xl border border-border/60 bg-white/90 p-4 dark:bg-slate-950/45">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t('card.abstract')}</div>
          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">
            {item.abstract}
          </p>

          {(item.categories?.length > 0 || item.matched_keywords?.length > 0) && (
            <div className="mt-4 space-y-3">
              {item.categories?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.categories.map((category) => (
                    <span
                      key={category}
                      className="rounded-md border border-border/50 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground"
                    >
                      {category}
                    </span>
                  ))}
                </div>
              )}

              {item.matched_keywords?.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground/70">{t('card.matchedKeywords')}</span>
                  {item.matched_keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-md border border-primary/30 bg-primary/[0.07] px-2 py-0.5 text-[10px] font-medium text-primary"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-white/90 p-4 dark:bg-slate-950/45">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
            {t('card.scoreBreakdown')}
          </div>
          <div className="space-y-2">
            {SCORE_COLORS.map(({ label, key, bar, dot }) => (
              <ScoreBar key={key} label={label} score={item[key] ?? 0} barClass={bar} dotClass={dot} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (isCardView) {
    return (
      <article className="group flex h-full flex-col overflow-hidden rounded-[24px] border border-border/60 bg-white/88 shadow-sm transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.06] dark:bg-slate-950/20 dark:hover:bg-slate-950/30">
        <div className="flex h-full flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {metaBadges}
              <h3 className="mt-3 text-[15px] font-semibold leading-6 tracking-tight text-foreground sm:text-base">
                {item.title}
              </h3>
              {item.authors && (
                <p className="mt-1 text-xs leading-5 text-muted-foreground/80 line-clamp-2">{item.authors}</p>
              )}
            </div>
            <div className="shrink-0">
              {scoreBadge}
            </div>
          </div>

          <div className="mt-4 text-sm leading-6 text-muted-foreground line-clamp-4">
            {item.abstract}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {actionButtons}
          </div>
        </div>

        {expanded && expandedContent}
      </article>
    );
  }

  return (
    <article className="group border-b border-border/60 bg-white/78 transition-colors duration-200 hover:bg-primary/[0.06] dark:bg-slate-950/10 dark:hover:bg-slate-950/30 last:border-b-0">
      <div className="grid gap-3 px-4 py-4 lg:grid-cols-[82px_minmax(0,1fr)_minmax(170px,220px)] lg:items-start lg:gap-4">
        <div className="flex gap-3 lg:flex-col">
          {scoreBadge}
        </div>

        <div className="min-w-0">
          {metaBadges}

          <h3 className="mt-2.5 text-[15px] font-semibold leading-6 tracking-tight text-foreground sm:text-base">
            {item.title}
          </h3>

          {item.authors && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground/80 line-clamp-2">{item.authors}</p>
          )}
        </div>

        <div className="flex flex-wrap items-start justify-start gap-2 lg:justify-end">
          {actionButtons}
        </div>
      </div>

      {expanded && expandedContent}
    </article>
  );
}
