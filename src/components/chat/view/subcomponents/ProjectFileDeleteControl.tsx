import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../ui/button';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import { dispatchProjectFileDeleted } from '../../../../utils/projectFileEvents';

type DeletableFile = {
  name: string;
  relativePath: string;
  absolutePath?: string | null;
};

type ProjectFileDeleteControlProps = {
  projectName: string;
  file: DeletableFile | null;
  onDeleted?: () => void;
  iconOnly?: boolean;
  buttonVariant?: 'default' | 'outline' | 'secondary' | 'ghost';
  className?: string;
};

export default function ProjectFileDeleteControl({
  projectName,
  file,
  onDeleted,
  iconOnly = false,
  buttonVariant = 'ghost',
  className,
}: ProjectFileDeleteControlProps) {
  const { t } = useTranslation('common');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        event.preventDefault();
        event.stopPropagation();
        setConfirmOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [confirmOpen, isDeleting]);

  useEffect(() => {
    setConfirmOpen(false);
    setErrorMessage(null);
  }, [file?.absolutePath, file?.relativePath]);

  if (!file || !projectName) {
    return null;
  }

  const deleteLabel = t('fileTree.deleteFile');

  const closeConfirmation = () => {
    if (!isDeleting) {
      setConfirmOpen(false);
      setErrorMessage(null);
    }
  };

  const handleDelete = async () => {
    const filePath = file.absolutePath || file.relativePath;
    if (!filePath || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const response = await api.deleteFile(projectName, filePath);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Delete failed (${response.status})`);
      }

      dispatchProjectFileDeleted({
        projectName,
        relativePath: file.relativePath,
        absolutePath: file.absolutePath || null,
        name: file.name,
      });
      setConfirmOpen(false);
      onDeleted?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={buttonVariant}
        onClick={() => {
          setErrorMessage(null);
          setConfirmOpen(true);
        }}
        className={cn(
          iconOnly ? 'h-9 w-9 p-0 !gap-0' : '!gap-1',
          className,
          'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
        )}
        title={deleteLabel}
        aria-label={deleteLabel}
      >
        <Trash2 className={cn('shrink-0', iconOnly ? 'h-5 w-5' : 'h-3.5 w-3.5')} />
        {!iconOnly ? deleteLabel : null}
      </Button>

      {confirmOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-file-preview-delete-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeConfirmation();
            }
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Trash2 className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="project-file-preview-delete-title" className="text-base font-semibold text-foreground">
                  {t('fileTree.deleteConfirmTitle')}
                </h2>
                <p className="mt-2 text-sm text-foreground">
                  {t('fileTree.confirmDelete', { name: file.name })}
                </p>
                <p className="mt-2 break-all rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
                  {file.relativePath || file.absolutePath}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('fileTree.deleteConfirmWarning')}
                </p>
                {errorMessage ? (
                  <p className="mt-3 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                    {errorMessage}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={closeConfirmation}
                disabled={isDeleting}
              >
                {t('buttons.cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="gap-2"
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {isDeleting ? t('fileTree.deletingFile') : t('fileTree.deleteConfirmAction')}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
