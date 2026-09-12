import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function DeleteBranchDialog({ name, disabled, onCancel, onConfirm }: {
  name: string;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('chat');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return createPortal(
    <dialog ref={dialog} aria-labelledby="delete-branch-title" aria-describedby="delete-branch-description"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/45 backdrop:backdrop-blur-sm">
      <div className="p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-destructive/10 p-2 text-destructive"><Trash2 size={18} /></div>
          <h2 id="delete-branch-title" className="text-base font-semibold">{t('canvas.deleteTitle')}</h2>
        </div>
        <p id="delete-branch-description" className="mt-3 break-words text-sm leading-6 text-muted-foreground">{t('canvas.deleteConfirm', { name })}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" autoFocus onClick={onCancel} className="rounded-lg px-4 py-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{t('canvas.deleteCancel')}</button>
          <button type="button" disabled={disabled} onClick={onConfirm} className="rounded-lg bg-destructive px-4 py-2 text-sm text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{t('canvas.deleteAction')}</button>
        </div>
      </div>
    </dialog>, document.body,
  );
}
