import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';

import { Button } from './ui/button';
import { api } from '../utils/api';
import type { Project } from '../types/app';

type DownloadArchiveScope = 'all' | 'publication' | 'experimentAnalysis';

type DownloadArchiveOption = {
  id: DownloadArchiveScope;
  labelKey: string;
  path: string;
  filenameSuffix: string;
};

const DOWNLOAD_ARCHIVE_OPTIONS: DownloadArchiveOption[] = [
  {
    id: 'all',
    labelKey: 'common:downloadDialog.options.all',
    path: '/',
    filenameSuffix: '',
  },
  {
    id: 'publication',
    labelKey: 'common:downloadDialog.options.publication',
    path: 'Publication/',
    filenameSuffix: 'Publication',
  },
  {
    id: 'experimentAnalysis',
    labelKey: 'common:downloadDialog.options.experimentAnalysis',
    path: 'Experiment/',
    filenameSuffix: 'Experiment',
  },
];

function sanitizeDownloadFileBase(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim() || 'project';
}

interface ProjectDownloadButtonProps {
  selectedProject: Project | null;
  className?: string;
}

export default function ProjectDownloadButton({
  selectedProject,
  className = 'h-7 w-7 p-0',
}: ProjectDownloadButtonProps) {
  const { t } = useTranslation(['common']);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [selectedDownloadScope, setSelectedDownloadScope] = useState<DownloadArchiveScope>('all');
  const [chooseDownloadLocation, setChooseDownloadLocation] = useState(false);

  const canChooseDownloadLocation = typeof window !== 'undefined' && Boolean(window.medhelpDesktop?.saveFile);
  const selectedDownloadOption = useMemo(
    () => DOWNLOAD_ARCHIVE_OPTIONS.find((option) => option.id === selectedDownloadScope) || DOWNLOAD_ARCHIVE_OPTIONS[0],
    [selectedDownloadScope],
  );

  const handleDownloadProject = useCallback(async () => {
    if (!selectedProject || isDownloading) {
      return;
    }

    setIsDownloading(true);

    try {
      const response = await api.downloadProjectArchive(selectedProject.name, {
        scope: selectedDownloadOption.id,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const retryAfterSeconds = Number(payload?.retryAfterSeconds);
        const retryText = response.status === 429 && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? ` Retry after ${Math.ceil(retryAfterSeconds)}s.`
          : '';
        throw new Error(`${payload?.error || 'Failed to download project archive'}${retryText}`);
      }

      const blob = await response.blob();
      const safeFileBase = sanitizeDownloadFileBase(String(selectedProject.displayName || selectedProject.name || 'project'));
      const safeFileName = `${safeFileBase}${selectedDownloadOption.filenameSuffix ? `-${selectedDownloadOption.filenameSuffix}` : ''}.zip`;

      if (chooseDownloadLocation && window.medhelpDesktop?.saveFile) {
        const saveResult = await window.medhelpDesktop.saveFile({
          defaultFileName: safeFileName,
          data: await blob.arrayBuffer(),
        });

        if (saveResult?.canceled) {
          return;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = safeFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      setDialogOpen(false);
    } catch (error) {
      console.error('Failed to download project archive:', error);
      window.alert(error instanceof Error ? error.message : 'Failed to download project archive');
    } finally {
      setIsDownloading(false);
    }
  }, [chooseDownloadLocation, isDownloading, selectedDownloadOption, selectedProject]);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className={className}
        onClick={() => setDialogOpen(true)}
        title={t('common:buttons.download')}
        aria-label={t('common:buttons.download')}
        disabled={!selectedProject || isDownloading}
      >
        {isDownloading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
      </Button>

      {dialogOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-download-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDownloading) {
              setDialogOpen(false);
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-xl border border-border bg-background p-5 shadow-2xl">
            <div className="space-y-1">
              <h2 id="project-download-dialog-title" className="text-base font-semibold text-foreground">
                {t('common:downloadDialog.title')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('common:downloadDialog.description')}
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {DOWNLOAD_ARCHIVE_OPTIONS.map((option) => {
                const checked = selectedDownloadScope === option.id;
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                      checked
                        ? 'border-primary/45 bg-primary/8 text-foreground'
                        : 'border-border bg-background text-foreground/88 hover:bg-muted/55'
                    }`}
                  >
                    <input
                      type="radio"
                      name="project-download-scope"
                      value={option.id}
                      checked={checked}
                      onChange={() => setSelectedDownloadScope(option.id)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium">{t(option.labelKey)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{option.path}</span>
                  </label>
                );
              })}
            </div>

            {canChooseDownloadLocation && (
              <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-foreground/88">
                <input
                  type="checkbox"
                  checked={chooseDownloadLocation}
                  onChange={(event) => setChooseDownloadLocation(event.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span>{t('common:downloadDialog.chooseLocation')}</span>
              </label>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={isDownloading}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('common:buttons.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDownloadProject();
                }}
                disabled={!selectedProject || isDownloading}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {isDownloading ? t('common:status.loading') : t('common:buttons.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
