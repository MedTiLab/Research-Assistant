import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder,
  History,
  MessageSquarePlus,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Project } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import type { SessionWithProvider } from '../../types/types';
import {
  buildSidebarSearchPalette,
  flattenSidebarSearchItems,
  formatModShortcut,
  isApplePlatform,
  type SidebarSearchActionId,
  type SidebarSearchGroupId,
  type SidebarSearchItem,
} from '../../utils/sidebarSearchPalette';

type SidebarSearchPaletteProps = {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  getSessions: (project: Project) => SessionWithProvider[];
  onSelectChat: (session: SessionWithProvider, projectName: string) => void;
  onSelectProject: (project: Project) => void;
  onCreateConversation: () => void;
  onOpenConversationHistory: () => void;
  t: TFunction;
};

const GROUP_LABEL_KEYS: Record<SidebarSearchGroupId, string> = {
  chats: 'searchPalette.chats',
  projects: 'searchPalette.projects',
  actions: 'searchPalette.actions',
};

const ACTION_ICONS: Record<SidebarSearchActionId, LucideIcon> = {
  newConversation: MessageSquarePlus,
  conversationHistory: History,
};

function itemIcon(item: SidebarSearchItem): LucideIcon {
  if (item.kind === 'chat') {
    return RotateCcw;
  }
  if (item.kind === 'project') {
    return Folder;
  }
  return ACTION_ICONS[item.id];
}

export default function SidebarSearchPalette({
  open,
  onClose,
  projects,
  getSessions,
  onSelectChat,
  onSelectProject,
  onCreateConversation,
  onOpenConversationHistory,
  t,
}: SidebarSearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isApple = isApplePlatform();

  const groups = useMemo(
    () =>
      buildSidebarSearchPalette({
        projects,
        getSessions,
        query,
        t,
      }),
    [getSessions, projects, query, t],
  );
  const items = useMemo(() => flattenSidebarSearchItems(groups), [groups]);
  const itemIndexById = useMemo(() => {
    const indexes = new Map<string, number>();
    items.forEach((item, index) => {
      indexes.set(item.id, index);
    });
    return indexes;
  }, [items]);
  const selectedItem = items[selectedIndex] ?? null;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, selectedIndex]);

  useEffect(() => {
    if (!open || !selectedItem) {
      return;
    }

    document.getElementById(`sidebar-search-${selectedItem.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedItem]);

  const activateItem = (item: SidebarSearchItem | null) => {
    if (!item) {
      return;
    }

    onClose();
    if (item.kind === 'chat') {
      onSelectChat(item.session, item.projectName);
      return;
    }
    if (item.kind === 'project') {
      onSelectProject(item.project);
      return;
    }
    if (item.id === 'newConversation') {
      onCreateConversation();
      return;
    }
    onOpenConversationHistory();
  };

  const moveSelection = (delta: number) => {
    if (items.length === 0) {
      return;
    }
    setSelectedIndex((current) => (current + delta + items.length) % items.length);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activateItem(selectedItem);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (isApple && event.metaKey && !event.shiftKey && !event.altKey && /^[1-9]$/.test(event.key)) {
      const shortcutIndex = Number(event.key);
      const match = items.find((item) => item.kind === 'chat' && item.shortcutIndex === shortcutIndex);
      if (match) {
        event.preventDefault();
        activateItem(match);
      }
    }
  };

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('searchPalette.placeholder')}
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="border-b border-border px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPalette.placeholder')}
            aria-label={t('searchPalette.placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-[min(420px,52vh)] overflow-y-auto px-2 py-2">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t('projects.noMatchingProjects')}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.id} className="pb-1.5 last:pb-0">
                <h2 className="px-3 pb-1 pt-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                  {t(GROUP_LABEL_KEYS[group.id])}
                </h2>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = itemIcon(item);
                    const globalIndex = itemIndexById.get(item.id) ?? 0;
                    const isSelected = globalIndex === selectedIndex;
                    const shortcut =
                      item.kind === 'chat' && item.shortcutIndex
                        ? formatModShortcut(isApple, String(item.shortcutIndex))
                        : null;

                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          id={`sidebar-search-${item.id}`}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                            isSelected
                              ? 'bg-accent text-foreground'
                              : 'text-foreground hover:bg-accent',
                          )}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                          onClick={() => activateItem(item)}
                        >
                          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                            {item.title}
                          </span>
                          {item.kind === 'chat' && (
                            <span className="max-w-[28%] truncate text-[12px] text-muted-foreground">
                              {item.projectLabel}
                            </span>
                          )}
                          {shortcut && isApple && (
                            <span className="flex-shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {shortcut}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
