import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { copyTextToClipboard } from '../../../../utils/clipboard';

type MessageShareDialogProps = {
  url: string;
  onClose: () => void;
};

function buildShareText(url: string) {
  return [
    '我分享了一段 MedHelp 只读对话，方便你查看这次讨论内容：',
    url,
    '请不要转发给无关人员。',
  ].join('\n');
}

export default function MessageShareDialog({ url, onClose }: MessageShareDialogProps) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const shareText = buildShareText(url);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const copyShareContent = async () => {
    const ok = await copyTextToClipboard(shareText);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">{t('messageShare.title', { defaultValue: '分享回答' })}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('messageShare.description', { defaultValue: '复制这个只读链接分享单条回答。' })}
            </p>
          </div>
          <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm leading-6">
          {shareText.split('\n').map((line) => (
            <div key={line} className="break-all">
              {line}
            </div>
          ))}
        </div>

        <button
          type="button"
          className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground"
          onClick={() => void copyShareContent()}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied
            ? t('messageShare.copied', { defaultValue: '已复制' })
            : t('messageShare.copy', { defaultValue: '复制' })}
        </button>
      </div>
    </div>,
    document.body,
  );
}
