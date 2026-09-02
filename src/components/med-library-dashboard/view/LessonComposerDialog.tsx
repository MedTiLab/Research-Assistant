import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Sparkles, Trash2, X } from 'lucide-react';

import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';

export type LessonComposerProject = {
  name: string;
  displayName: string;
};

export type LessonComposerSeed = {
  projectName?: string | null;
  sessionId?: string | null;
  provider?: string | null;
  slug?: string | null;
  title?: string;
  trigger?: string;
  correctPattern?: string;
  severity?: string;
  stageHints?: string[];
  evidenceSnippet?: string | null;
  mode?: 'write' | 'draft';
};

type DraftRow = {
  key: string;
  selected: boolean;
  title: string;
  trigger: string;
  correctPattern: string;
  severity: string;
  category: string;
  stageHints: string[];
};

const SEVERITIES = ['high', 'medium', 'low'] as const;
const STAGES = ['literature', 'experiment', 'publication'] as const;

const FIELD_CLASS = 'min-h-[84px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';
const LABEL_CLASS = 'text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80';

function ChipToggle({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-border/60 bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

export default function LessonComposerDialog({
  seed,
  projects,
  onClose,
  onSaved,
}: {
  seed: LessonComposerSeed;
  projects: LessonComposerProject[];
  onClose: () => void;
  onSaved: (savedCount: number) => void;
}) {
  const { t, i18n } = useTranslation('medlibrary');
  const isEdit = Boolean(seed.slug);

  const [projectName, setProjectName] = useState(seed.projectName || projects[0]?.name || '');
  const [title, setTitle] = useState(seed.title || '');
  const [trigger, setTrigger] = useState(seed.trigger || '');
  const [correctPattern, setCorrectPattern] = useState(seed.correctPattern || '');
  const [severity, setSeverity] = useState(seed.severity || 'medium');
  const [stageHints, setStageHints] = useState<string[]>(seed.stageHints || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drafting, setDrafting] = useState(false);
  const [draftRows, setDraftRows] = useState<DraftRow[] | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const canDraft = Boolean(projectName) && (Boolean(seed.sessionId) || Boolean(seed.evidenceSnippet));
  const canSaveSingle = Boolean(projectName) && trigger.trim().length > 0 && correctPattern.trim().length > 0;

  const toggleStage = useCallback((stage: string) => {
    setStageHints((prev) => (prev.includes(stage) ? prev.filter((item) => item !== stage) : [...prev, stage]));
  }, []);

  const buildEvidence = useCallback(() => {
    if (!seed.evidenceSnippet) {
      return [];
    }
    return [{
      snippet: seed.evidenceSnippet.slice(0, 320),
      source: 'manual_capture',
      sessionId: seed.sessionId || null,
      provider: seed.provider || null,
    }];
  }, [seed.evidenceSnippet, seed.provider, seed.sessionId]);

  const handleSaveSingle = useCallback(async () => {
    if (!canSaveSingle || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = {
        projectName,
        title: title.trim(),
        trigger: trigger.trim(),
        correctPattern: correctPattern.trim(),
        severity,
        stageHints,
        evidence: buildEvidence(),
      };
      const res = seed.slug
        ? await api.medLibrary.updateLesson(seed.slug, body)
        : await api.medLibrary.createLesson(body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t('lessonComposer.errors.saveFailed'));
      }
      onSaved(1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('lessonComposer.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [
    buildEvidence, canSaveSingle, correctPattern, onSaved, projectName,
    saving, seed.slug, severity, stageHints, t, title, trigger,
  ]);

  const handleDraft = useCallback(async () => {
    if (!canDraft || drafting) {
      return;
    }

    setDrafting(true);
    setError(null);
    setDraftNotice(null);
    try {
      const res = await api.medLibrary.draftLessons({
        projectName,
        sessionId: seed.sessionId || '',
        provider: seed.provider || '',
        text: seed.evidenceSnippet || '',
        language: i18n.language?.startsWith('zh') ? 'zh' : 'en',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t('lessonComposer.errors.draftFailed'));
      }

      const rows: DraftRow[] = (data.drafts || []).map((item: Record<string, unknown>, index: number) => ({
        key: `draft-${index}`,
        selected: true,
        title: String(item.title || ''),
        trigger: String(item.trigger || ''),
        correctPattern: String(item.correctPattern || ''),
        severity: String(item.severity || 'medium'),
        category: String(item.category || 'manual'),
        stageHints: Array.isArray(item.stageHints) ? item.stageHints.map(String) : [],
      }));

      setDraftRows(rows);
      if (rows.length === 0) {
        setDraftNotice(t('lessonComposer.draft.noResults'));
      }
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : t('lessonComposer.errors.draftFailed'));
    } finally {
      setDrafting(false);
    }
  }, [canDraft, drafting, i18n.language, projectName, seed.evidenceSnippet, seed.provider, seed.sessionId, t]);

  const selectedDraftCount = useMemo(
    () => (draftRows || []).filter((row) => row.selected && row.trigger.trim() && row.correctPattern.trim()).length,
    [draftRows],
  );

  const updateDraftRow = useCallback((key: string, patch: Partial<DraftRow>) => {
    setDraftRows((prev) => (prev || []).map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }, []);

  const handleSaveDrafts = useCallback(async () => {
    const rows = (draftRows || []).filter((row) => row.selected && row.trigger.trim() && row.correctPattern.trim());
    if (rows.length === 0 || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let saved = 0;
      for (const row of rows) {
        const res = await api.medLibrary.createLesson({
          projectName,
          title: row.title.trim(),
          trigger: row.trigger.trim(),
          correctPattern: row.correctPattern.trim(),
          severity: row.severity,
          category: row.category,
          stageHints: row.stageHints,
          evidence: buildEvidence(),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || t('lessonComposer.errors.saveFailed'));
        }
        saved += 1;
      }
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('lessonComposer.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [buildEvidence, draftRows, onSaved, projectName, saving, t]);

  const dialogTitle = isEdit
    ? t('lessonComposer.editTitle')
    : draftRows
      ? t('lessonComposer.draft.reviewTitle')
      : t('lessonComposer.title');
  const dialogLead = isEdit
    ? t('lessonComposer.editLead')
    : draftRows
      ? t('lessonComposer.draft.reviewLead')
      : t('lessonComposer.lead');

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm md:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-border/70 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-foreground">{dialogTitle}</h3>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{dialogLead}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="panel-scroll-area flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {draftNotice ? (
            <div className="mb-4 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {draftNotice}
            </div>
          ) : null}

          <div className="space-y-2">
            <label className={LABEL_CLASS}>{t('lessonComposer.fields.project')}</label>
            <select
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              disabled={isEdit || Boolean(draftRows)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
            >
              {projects.length === 0 ? <option value="">{t('lessonComposer.fields.noProjects')}</option> : null}
              {projects.map((project) => (
                <option key={project.name} value={project.name}>{project.displayName}</option>
              ))}
            </select>
          </div>

          {draftRows ? (
            <div className="mt-5 space-y-3">
              {draftRows.map((row) => (
                <div
                  key={row.key}
                  className={cn(
                    'rounded-2xl border p-4 transition-colors',
                    row.selected ? 'border-primary/30 bg-primary/[0.04]' : 'border-border/60 bg-muted/20',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => updateDraftRow(row.key, { selected: !row.selected })}
                      className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          row.selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                        )}
                      >
                        {row.selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 text-sm font-semibold text-foreground">{row.title}</span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs text-destructive"
                      onClick={() => setDraftRows((prev) => (prev || []).filter((item) => item.key !== row.key))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>{t('lessonComposer.fields.trigger')}</label>
                      <textarea
                        value={row.trigger}
                        onChange={(event) => updateDraftRow(row.key, { trigger: event.target.value })}
                        className={cn(FIELD_CLASS, 'min-h-[60px]')}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>{t('lessonComposer.fields.correctPattern')}</label>
                      <textarea
                        value={row.correctPattern}
                        onChange={(event) => updateDraftRow(row.key, { correctPattern: event.target.value })}
                        className={cn(FIELD_CLASS, 'min-h-[60px]')}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <label className={LABEL_CLASS}>{t('lessonComposer.fields.trigger')}</label>
                <textarea
                  value={trigger}
                  onChange={(event) => setTrigger(event.target.value)}
                  placeholder={t('lessonComposer.fields.triggerPlaceholder')}
                  className={FIELD_CLASS}
                />
              </div>

              <div className="space-y-2">
                <label className={LABEL_CLASS}>{t('lessonComposer.fields.correctPattern')}</label>
                <textarea
                  value={correctPattern}
                  onChange={(event) => setCorrectPattern(event.target.value)}
                  placeholder={t('lessonComposer.fields.correctPatternPlaceholder')}
                  className={FIELD_CLASS}
                />
              </div>

              <div className="space-y-2">
                <label className={LABEL_CLASS}>{t('lessonComposer.fields.title')}</label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('lessonComposer.fields.titlePlaceholder')}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className={LABEL_CLASS}>{t('lessonComposer.fields.severity')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SEVERITIES.map((value) => (
                      <ChipToggle
                        key={value}
                        active={severity === value}
                        label={t(`lessonComposer.severity.${value}`)}
                        onClick={() => setSeverity(value)}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className={LABEL_CLASS}>{t('lessonComposer.fields.stage')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {STAGES.map((value) => (
                      <ChipToggle
                        key={value}
                        active={stageHints.includes(value)}
                        label={t(`lessonComposer.stage.${value}`)}
                        onClick={() => toggleStage(value)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {seed.evidenceSnippet ? (
                <div className="space-y-2">
                  <label className={LABEL_CLASS}>{t('lessonComposer.fields.evidence')}</label>
                  <p className="line-clamp-3 rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
                    {seed.evidenceSnippet}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
          <div>
            {!isEdit && !draftRows && canDraft ? (
              <Button type="button" variant="outline" size="sm" onClick={() => { handleDraft().catch(() => {}); }} disabled={drafting}>
                {drafting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                {t('lessonComposer.actions.draft')}
              </Button>
            ) : null}
            {draftRows ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraftRows(null)}>
                {t('lessonComposer.actions.backToManual')}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t('lessonComposer.actions.cancel')}
            </Button>
            {draftRows ? (
              <Button
                type="button"
                size="sm"
                onClick={() => { handleSaveDrafts().catch(() => {}); }}
                disabled={saving || selectedDraftCount === 0}
              >
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {t('lessonComposer.actions.saveSelected', { count: selectedDraftCount })}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => { handleSaveSingle().catch(() => {}); }}
                disabled={saving || !canSaveSingle}
              >
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {t('lessonComposer.actions.save')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
