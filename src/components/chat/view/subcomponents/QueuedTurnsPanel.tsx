import { Check, ChevronDown, ChevronUp, GripVertical, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueuedChatTurn } from '../../types/types';

interface QueuedTurnsPanelProps {
  items: QueuedChatTurn[];
  onEdit: (itemId: string, content: string) => void;
  onRemove: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onClear: () => void;
}

export default function QueuedTurnsPanel({
  items,
  onEdit,
  onRemove,
  onReorder,
  onClear,
}: QueuedTurnsPanelProps) {
  const { t } = useTranslation('chat');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuId) return undefined;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuId]);

  if (items.length === 0) return null;

  const move = (itemId: string, direction: -1 | 1) => {
    const currentIndex = items.findIndex((item) => item.id === itemId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, moved);
    onReorder(next.map((item) => item.id));
  };

  const dropBefore = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const next = items.filter((item) => item.id !== draggedId);
    const targetIndex = next.findIndex((item) => item.id === targetId);
    const dragged = items.find((item) => item.id === draggedId);
    if (!dragged || targetIndex < 0) return;
    next.splice(targetIndex, 0, dragged);
    onReorder(next.map((item) => item.id));
    setDraggedId(null);
  };

  const beginEdit = (item: QueuedChatTurn) => {
    setEditingId(item.id);
    setDraft(item.content);
    setMenuId(null);
  };

  const saveEdit = () => {
    if (!editingId || !draft.trim()) return;
    onEdit(editingId, draft.trim());
    setEditingId(null);
    setDraft('');
  };

  return (
    <div className="mx-auto mb-2 max-w-5xl overflow-visible rounded-2xl border border-border/70 bg-card/95 shadow-sm">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="h-2 w-2 rounded-full border border-sky-400 bg-sky-100 dark:bg-sky-950" />
          {t('queue.count', { count: items.length, defaultValue: '{{count}} queued' })}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t('queue.clear', { defaultValue: 'Clear queue' })}
        >
          <X className="h-3.5 w-3.5" />
          {t('queue.close', { defaultValue: 'Close queue' })}
        </button>
      </div>

      <div className="divide-y divide-border/40">
        {items.map((item, index) => (
          <div
            key={item.id}
            draggable={editingId !== item.id}
            onDragStart={() => setDraggedId(item.id)}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropBefore(item.id)}
            className={`relative flex items-start gap-2 px-2 py-2.5 transition-colors ${draggedId === item.id ? 'opacity-45' : 'hover:bg-muted/25'}`}
          >
            <button
              type="button"
              className="mt-1 cursor-grab rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
              title={t('queue.drag', { defaultValue: 'Drag to reorder' })}
              aria-label={t('queue.drag', { defaultValue: 'Drag to reorder' })}
            >
              <GripVertical className="h-4 w-4" />
            </button>

            <div className="min-w-0 flex-1">
              {editingId === item.id ? (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveEdit();
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                  className="min-h-[72px] w-full resize-y rounded-xl border border-primary/40 bg-background px-3 py-2 text-sm outline-none ring-2 ring-primary/10"
                />
              ) : (
                <button
                  type="button"
                  onDoubleClick={() => beginEdit(item)}
                  className="line-clamp-3 w-full whitespace-pre-wrap text-left text-sm leading-5 text-foreground"
                  title={t('queue.doubleClickEdit', { defaultValue: 'Double-click to edit' })}
                >
                  {item.content}
                </button>
              )}
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t('queue.position', {
                  current: index + 1,
                  total: items.length,
                  defaultValue: '{{current}} / {{total}}',
                })}
              </div>
            </div>

            {editingId === item.id ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={!draft.trim()}
                  className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40"
                  title={t('queue.save', { defaultValue: 'Save edit' })}
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                  title={t('queue.cancelEdit', { defaultValue: 'Cancel edit' })}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(item.id, -1)}
                  disabled={index === 0}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-25"
                  title={t('queue.moveUp', { defaultValue: 'Move up' })}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(item.id, 1)}
                  disabled={index === items.length - 1}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-25"
                  title={t('queue.moveDown', { defaultValue: 'Move down' })}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t('queue.remove', { defaultValue: 'Remove from queue' })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div ref={menuId === item.id ? menuRef : undefined} className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuId((current) => current === item.id ? null : item.id)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    title={t('queue.more', { defaultValue: 'More actions' })}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                  {menuId === item.id && (
                    <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-border bg-popover p-1.5 shadow-xl">
                      <button
                        type="button"
                        onClick={() => beginEdit(item)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
                      >
                        <Pencil className="h-4 w-4" />
                        {t('queue.edit', { defaultValue: 'Edit message' })}
                      </button>
                      <button
                        type="button"
                        onClick={() => { onRemove(item.id); setMenuId(null); }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('queue.remove', { defaultValue: 'Remove from queue' })}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
