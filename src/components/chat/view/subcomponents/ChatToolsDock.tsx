import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { PanelRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Floating tools: neither the trigger nor the expanded dock reserves a column. */
export default function ChatToolsDock({ children, onCollapse, panelOpen = false }: { children: ReactNode | ((dismiss: () => void) => ReactNode); onCollapse: () => void; panelOpen?: boolean }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const dismiss = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [open]);
  const close = () => { setOpen(false); onCollapse(); };
  return (
    <div ref={root} className="absolute right-2 top-2 z-40 flex flex-col items-end gap-2" data-chat-tools-dock="true"
      onKeyDown={(event) => { if (event.key === 'Escape' && (open || panelOpen)) { event.stopPropagation(); close(); event.currentTarget.querySelector('button')?.focus(); } }}>
      <button type="button" aria-label={t(open || panelOpen ? 'sessionContext.actions.hideTools' : 'sessionContext.actions.showTools')}
        title={t(open || panelOpen ? 'sessionContext.actions.hideTools' : 'sessionContext.actions.showTools')}
        aria-expanded={open || panelOpen} aria-controls={open ? id : undefined}
        onClick={() => open || panelOpen ? close() : setOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <PanelRight className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.9} />
      </button>
      {open && <div id={id} role="group" aria-label={t('sessionContext.actions.showTools')}
        className="flex flex-col items-center rounded-xl border border-border/60 bg-popover p-1 shadow-lg">
        {typeof children === 'function' ? children(dismiss) : children}
      </div>}
    </div>
  );
}
