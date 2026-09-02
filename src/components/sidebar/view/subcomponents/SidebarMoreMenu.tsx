import { LayoutGrid } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TFunction } from 'i18next';
import type { AppTab } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import Tooltip from '../../../Tooltip';
import {
  groupSidebarNavTiles,
  type SidebarNavTile,
} from './sidebarNavTiles';

type SidebarMoreMenuProps = {
  activeTab: AppTab;
  tiles: SidebarNavTile[];
  t: TFunction;
  variant: 'icon' | 'row';
};

export default function SidebarMoreMenu({
  activeTab,
  tiles,
  t,
  variant,
}: SidebarMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const groups = useMemo(() => groupSidebarNavTiles(tiles), [tiles]);
  const isActive = tiles.some((tile) => tile.matchTabs.includes(activeTab));
  const moreLabel = t('rail.more');
  const moreHint = t('rail.moreHint');

  const updateMenuPosition = () => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const estimatedHeight = tiles.length * 40 + Math.max(0, groups.length - 1) * 9 + 16;
    const top = Math.min(rect.top, Math.max(12, window.innerHeight - estimatedHeight - 12));
    setMenuPosition({
      top,
      left: rect.right + 8,
    });
  };

  const toggleMenu = () => {
    if (!open) {
      updateMenuPosition();
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    const handleViewportChange = () => {
      updateMenuPosition();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [groups.length, open, tiles.length]);

  useEffect(() => {
    setOpen(false);
  }, [activeTab]);

  const highlighted = open || isActive;

  return (
    <div className={variant === 'row' ? 'w-full' : 'relative'}>
      {variant === 'icon' ? (
        <Tooltip content={open ? undefined : `${moreLabel} · ${moreHint}`} position="right" delay={120}>
          <button
            ref={buttonRef}
            type="button"
            onClick={toggleMenu}
            title={moreLabel}
            aria-label={moreLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors',
              'hover:bg-accent/80 hover:text-foreground',
              highlighted && 'bg-primary/12 text-primary shadow-sm',
            )}
          >
            {highlighted && (
              <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
            )}
            <LayoutGrid className="h-5 w-5" strokeWidth={highlighted ? 2.25 : 1.85} />
          </button>
        </Tooltip>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleMenu}
          title={`${moreLabel} · ${moreHint}`}
          aria-label={moreLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
            highlighted
              ? 'bg-accent/90 text-foreground'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          )}
        >
          <LayoutGrid className="h-4 w-4 flex-shrink-0" strokeWidth={highlighted ? 2.2 : 1.85} />
          <span className="text-[13.5px] font-medium">{moreLabel}</span>
          <span className="ml-auto truncate text-[11px] font-normal text-muted-foreground">
            {moreHint}
          </span>
        </button>
      )}

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('rail.moreMenu')}
          className="fixed z-[80] min-w-[188px] overflow-hidden rounded-xl border border-border/70 bg-card py-1.5 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.55)] dark:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.72)]"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          {groups.map((entry, index) => (
            <div key={entry.group}>
              {index > 0 && <div className="mx-2 my-1.5 h-px bg-border/70" />}
              {entry.tiles.map((tile) => {
                const Icon = tile.icon;
                const tileActive = tile.matchTabs.includes(activeTab);
                const label = t(tile.labelKey);

                return (
                  <button
                    key={tile.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      tile.onClick();
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-muted-foreground transition-colors',
                      'hover:bg-accent/80 hover:text-foreground',
                      tileActive && 'bg-primary/10 text-primary',
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={tileActive ? 2.2 : 1.85} />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
