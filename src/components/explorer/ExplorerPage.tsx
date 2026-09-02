import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ScrollArea } from '../ui/scroll-area';

const EXPLORER_SIDEBAR_STORAGE_KEY = 'med-help-explorer-sidebar-width';
const EXPLORER_SIDEBAR_DEFAULT_WIDTH = 320;
const EXPLORER_SIDEBAR_MIN_WIDTH = 220;
const EXPLORER_SIDEBAR_MAX_WIDTH = 520;
const EXPLORER_RESULTS_MIN_WIDTH = 320;
const EXPLORER_RESIZE_HANDLE_WIDTH = 4;

function maxExplorerSidebarWidth(containerWidth: number) {
  return Math.max(
    EXPLORER_SIDEBAR_MIN_WIDTH,
    Math.min(
      EXPLORER_SIDEBAR_MAX_WIDTH,
      containerWidth - EXPLORER_RESULTS_MIN_WIDTH - EXPLORER_RESIZE_HANDLE_WIDTH,
    ),
  );
}

function clampExplorerSidebarWidth(width: number, containerWidth: number) {
  return Math.min(
    maxExplorerSidebarWidth(containerWidth),
    Math.max(EXPLORER_SIDEBAR_MIN_WIDTH, width),
  );
}

function readExplorerSidebarWidth() {
  if (typeof window === 'undefined') {
    return EXPLORER_SIDEBAR_DEFAULT_WIDTH;
  }

  try {
    const storedValue = window.localStorage.getItem(EXPLORER_SIDEBAR_STORAGE_KEY);
    if (storedValue == null) {
      return EXPLORER_SIDEBAR_DEFAULT_WIDTH;
    }
    const saved = Number(storedValue);
    return Number.isFinite(saved)
      ? Math.min(EXPLORER_SIDEBAR_MAX_WIDTH, Math.max(EXPLORER_SIDEBAR_MIN_WIDTH, saved))
      : EXPLORER_SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return EXPLORER_SIDEBAR_DEFAULT_WIDTH;
  }
}

function persistExplorerSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(EXPLORER_SIDEBAR_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

export function explorerItemClass(active: boolean) {
  return cn(
    'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
    active
      ? 'border-border bg-muted/70 font-semibold text-foreground'
      : 'border-border/70 bg-background text-foreground hover:bg-muted/60',
  );
}

export function ExplorerPage({
  eyebrow,
  title,
  countLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  searchAddon,
  sidebar,
  resultsEyebrow,
  resultsTitle,
  resultsDescription,
  resultsActions,
  children,
  onMenuClick,
  className,
}: {
  eyebrow: string;
  title: string;
  countLabel?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchAddon?: ReactNode;
  sidebar: ReactNode;
  resultsEyebrow?: string;
  resultsTitle: ReactNode;
  resultsDescription?: ReactNode;
  resultsActions?: ReactNode;
  children: ReactNode;
  onMenuClick?: () => void;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readExplorerSidebarWidth);
  const sidebarWidthRef = useRef(sidebarWidth);

  const applySidebarWidth = useCallback((nextWidth: number) => {
    sidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
  }, []);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry || !window.matchMedia('(min-width: 1024px)').matches) {
        return;
      }
      const nextWidth = clampExplorerSidebarWidth(sidebarWidthRef.current, entry.contentRect.width);
      if (nextWidth !== sidebarWidthRef.current) {
        applySidebarWidth(nextWidth);
      }
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, [applySidebarWidth]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !layoutRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();

    const pointerId = event.pointerId;
    const layoutRect = layoutRef.current.getBoundingClientRect();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const resizeShield = document.createElement('div');
    resizeShield.setAttribute('aria-hidden', 'true');
    resizeShield.dataset.explorerResizeShield = 'true';
    Object.assign(resizeShield.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      cursor: 'col-resize',
      touchAction: 'none',
      background: 'transparent',
    });
    document.body.appendChild(resizeShield);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      applySidebarWidth(clampExplorerSidebarWidth(moveEvent.clientX - layoutRect.left, layoutRect.width));
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', finishResize);
      document.removeEventListener('pointercancel', finishResize);
      window.removeEventListener('blur', finishResize);
      resizeShield.remove();
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      resizeCleanupRef.current = null;
    };

    const finishResize = () => {
      persistExplorerSidebarWidth(sidebarWidthRef.current);
      cleanup();
    };

    resizeCleanupRef.current = cleanup;
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', finishResize);
    document.addEventListener('pointercancel', finishResize);
    window.addEventListener('blur', finishResize);
  }, [applySidebarWidth]);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const nextWidth = clampExplorerSidebarWidth(
      sidebarWidthRef.current + direction * (event.shiftKey ? 32 : 12),
      layoutWidth,
    );
    event.preventDefault();
    applySidebarWidth(nextWidth);
    persistExplorerSidebarWidth(nextWidth);
  }, [applySidebarWidth]);

  const resetSidebarWidth = useCallback(() => {
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY;
    const nextWidth = clampExplorerSidebarWidth(EXPLORER_SIDEBAR_DEFAULT_WIDTH, layoutWidth);
    applySidebarWidth(nextWidth);
    persistExplorerSidebarWidth(nextWidth);
  }, [applySidebarWidth]);

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-background', className)}>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col overflow-hidden p-4 sm:p-6">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm sm:hidden"
            aria-label={t('explorer.openNav')}
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        <div
          ref={layoutRef}
          className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card/95 lg:grid-cols-[var(--explorer-sidebar-width)_4px_minmax(0,1fr)]"
          style={{ '--explorer-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        >
          <aside className="flex min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 space-y-3 border-b border-border/70 px-4 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  {eyebrow}
                </p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                  {countLabel ? (
                    <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      {countLabel}
                    </span>
                  ) : null}
                </div>
              </div>
              {(onSearchChange || searchAddon) && (
                <div className="relative">
                  {onSearchChange ? (
                    <>
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={searchValue ?? ''}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={searchPlaceholder}
                        className="h-8 w-full rounded-lg border border-border/60 bg-background pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                      />
                      {searchValue ? (
                        <button
                          type="button"
                          onClick={() => onSearchChange('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
                          aria-label={t('explorer.clearSearch')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </>
                  ) : searchAddon}
                </div>
              )}
            </div>
            <ScrollArea className="panel-scroll-area sidebar-scroll-area min-h-0 flex-1">
              <div className="space-y-1 p-3">{sidebar}</div>
            </ScrollArea>
          </aside>

          <div
            role="separator"
            aria-label={t('explorer.resizeList')}
            aria-orientation="vertical"
            aria-valuemin={EXPLORER_SIDEBAR_MIN_WIDTH}
            aria-valuemax={EXPLORER_SIDEBAR_MAX_WIDTH}
            aria-valuenow={Math.round(sidebarWidth)}
            tabIndex={0}
            className="group relative hidden h-full cursor-col-resize touch-none bg-transparent outline-none lg:block focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
            onPointerDown={startSidebarResize}
            onKeyDown={handleResizeKeyDown}
            onDoubleClick={resetSidebarWidth}
            title={t('explorer.resizeHint')}
            data-explorer-resize-handle="true"
          >
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-[width,background-color] group-hover:w-0.5 group-hover:bg-primary/55 group-active:w-0.5 group-active:bg-primary/70" />
          </div>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border/70 p-5">
              {resultsEyebrow ? (
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  {resultsEyebrow}
                </p>
              ) : null}
              <div className={cn('flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between', resultsEyebrow && 'mt-2')}>
                <div className="min-w-0">
                  <h3 className="break-words text-xl font-semibold leading-tight text-foreground">
                    {resultsTitle}
                  </h3>
                  {resultsDescription ? (
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">{resultsDescription}</div>
                  ) : null}
                </div>
                {resultsActions ? (
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                    {resultsActions}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="panel-scroll-area min-h-0 flex-1 overflow-y-auto">
              {children}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
