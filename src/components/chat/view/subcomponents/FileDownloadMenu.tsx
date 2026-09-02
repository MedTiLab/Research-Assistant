import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileCode2, FileText, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../ui/button';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';

type DownloadFormat = 'original' | 'docx' | 'pdf';

type DownloadableFile = {
  name?: string;
  relativePath?: string;
  absolutePath?: string | null;
};

type FileDownloadMenuProps = {
  projectName: string;
  file: DownloadableFile | null;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  onError?: (error: unknown) => void;
};

const MARKDOWN_FILE_PATTERN = /\.(?:md|mdx|markdown)$/i;

function replaceMarkdownExtension(fileName: string, extension: 'docx' | 'pdf') {
  return MARKDOWN_FILE_PATTERN.test(fileName)
    ? fileName.replace(MARKDOWN_FILE_PATTERN, `.${extension}`)
    : `${fileName}.${extension}`;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function FileDownloadMenu({
  projectName,
  file,
  disabled = false,
  compact = false,
  className,
  onError,
}: FileDownloadMenuProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<DownloadFormat | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const fileName = file?.name || 'download';
  const filePath = file?.absolutePath || file?.relativePath || '';
  const isMarkdown = MARKDOWN_FILE_PATTERN.test(fileName || filePath);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setBusyFormat(null);
    setErrorMessage('');
  }, [filePath]);

  const download = async (format: DownloadFormat) => {
    if (!projectName || !filePath || busyFormat) return;

    setOpen(false);
    setBusyFormat(format);
    setErrorMessage('');
    try {
      const exportFormat = format === 'original' ? undefined : format;
      const blob = await api.getFileContentBlob(projectName, filePath, exportFormat ? { format: exportFormat } : undefined);
      const outputName = format === 'original'
        ? fileName
        : replaceMarkdownExtension(fileName, format);
      triggerBlobDownload(blob, outputName);
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : t('sessionContext.preview.downloadFormats.failed');
      setErrorMessage(message);
      setOpen(true);
      onError?.(error);
    } finally {
      setBusyFormat(null);
    }
  };

  const buttonClassName = cn(
    'whitespace-nowrap',
    compact ? 'h-7 !gap-1 px-1.5 text-[11px] [&>svg]:!h-3.5 [&>svg]:!w-3.5' : 'h-8 px-2 text-xs',
    className,
  );

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={buttonClassName}
        disabled={disabled || Boolean(busyFormat) || !filePath}
        aria-haspopup={isMarkdown ? 'menu' : undefined}
        aria-expanded={isMarkdown ? open : undefined}
        title={isMarkdown
          ? t('sessionContext.preview.downloadFormats.choose', { defaultValue: 'Choose download format' })
          : tCommon('buttons.download')}
        onClick={() => {
          if (isMarkdown) {
            setOpen((current) => !current);
          } else {
            void download('original');
          }
        }}
      >
        {busyFormat ? <Loader2 className="animate-spin" /> : <Download />}
        <span>{tCommon('buttons.download')}</span>
        {isMarkdown ? <ChevronDown className={cn('transition-transform', open && 'rotate-180')} /> : null}
      </Button>

      {isMarkdown && open ? (
        <div
          role="menu"
          aria-label={t('sessionContext.preview.downloadFormats.choose', { defaultValue: 'Choose download format' })}
          className="absolute right-0 top-full z-[80] mt-1 w-56 overflow-hidden rounded-lg border border-border/70 bg-popover p-1 text-popover-foreground shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent"
            onClick={() => void download('original')}
          >
            <FileCode2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">{t('sessionContext.preview.downloadFormats.markdown')}</span>
              <span className="block text-[11px] text-muted-foreground">{t('sessionContext.preview.downloadFormats.markdownHint')}</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent"
            onClick={() => void download('docx')}
          >
            <FileText className="mt-0.5 h-4 w-4 text-blue-600" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">{t('sessionContext.preview.downloadFormats.word')}</span>
              <span className="block text-[11px] text-muted-foreground">{t('sessionContext.preview.downloadFormats.wordHint')}</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent"
            onClick={() => void download('pdf')}
          >
            <FileText className="mt-0.5 h-4 w-4 text-red-600" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">{t('sessionContext.preview.downloadFormats.pdf')}</span>
              <span className="block text-[11px] text-muted-foreground">{t('sessionContext.preview.downloadFormats.pdfHint')}</span>
            </span>
          </button>
          {errorMessage ? (
            <div role="alert" className="mx-1 mb-1 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-4 text-destructive">
              {t('sessionContext.preview.downloadFormats.failed')}: {errorMessage}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
