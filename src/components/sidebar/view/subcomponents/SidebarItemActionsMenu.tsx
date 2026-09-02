import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Edit3, MoreHorizontal, Star, Trash2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';

type SidebarItemActionsMenuProps = {
  isStarred: boolean;
  menuLabel: string;
  addFavoriteLabel: string;
  removeFavoriteLabel: string;
  renameLabel: string;
  deleteLabel: string;
  onToggleStar: () => void;
  onRename: () => void;
  onDelete: () => void;
  buttonVisible?: boolean;
  buttonClassName?: string;
  iconClassName?: string;
  onOpenChange?: (isOpen: boolean) => void;
};

export default function SidebarItemActionsMenu({
  isStarred,
  menuLabel,
  addFavoriteLabel,
  removeFavoriteLabel,
  renameLabel,
  deleteLabel,
  onToggleStar,
  onRename,
  onDelete,
  buttonVisible = true,
  buttonClassName,
  iconClassName,
  onOpenChange,
}: SidebarItemActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isButtonVisible = buttonVisible || isOpen;

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return undefined;
    }

    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const menuWidth = 192;
      const menuHeight = 142;
      const viewportPadding = 12;
      const left = Math.min(
        window.innerWidth - menuWidth - viewportPadding,
        Math.max(viewportPadding, rect.right - menuWidth),
      );
      const preferredTop = rect.bottom + 8;
      const top = preferredTop + menuHeight <= window.innerHeight - viewportPadding
        ? preferredTop
        : Math.max(viewportPadding, rect.top - menuHeight - 8);

      setMenuPosition({ top, left });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const runAndClose = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className={cn('relative flex-shrink-0', !isButtonVisible && 'pointer-events-none')}>
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground',
          isButtonVisible ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
          isOpen && 'bg-muted text-foreground',
          isStarred && 'text-yellow-600 dark:text-yellow-400',
          buttonClassName,
        )}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-hidden={!isButtonVisible}
        tabIndex={isButtonVisible ? 0 : -1}
        title={menuLabel}
      >
        <MoreHorizontal className={cn('h-4 w-4', iconClassName)} strokeWidth={2} />
      </button>

      {isOpen && menuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed min-w-[11rem] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-slate-800 dark:bg-slate-950 dark:ring-white/10"
          style={{ top: menuPosition.top, left: menuPosition.left, zIndex: 9999 }}
          role="menu"
          aria-label={menuLabel}
        >
          <button
            type="button"
            onClick={() => runAndClose(onToggleStar)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/90 transition-colors hover:bg-muted/60"
            role="menuitem"
          >
            <Star
              className={cn(
                'h-4 w-4 flex-shrink-0',
                isStarred ? 'fill-current text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground',
              )}
              strokeWidth={1.9}
            />
            <span className="truncate">{isStarred ? removeFavoriteLabel : addFavoriteLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => runAndClose(onRename)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/90 transition-colors hover:bg-muted/60"
            role="menuitem"
          >
            <Edit3 className="h-4 w-4 flex-shrink-0" strokeWidth={1.9} />
            <span className="truncate">{renameLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => runAndClose(onDelete)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50/80 dark:text-red-400 dark:hover:bg-red-900/20"
            role="menuitem"
          >
            <Trash2 className="h-4 w-4 flex-shrink-0" strokeWidth={1.9} />
            <span className="truncate">{deleteLabel}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
