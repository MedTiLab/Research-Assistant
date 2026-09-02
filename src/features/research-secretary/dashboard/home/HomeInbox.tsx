import { Send, Trash2 } from 'lucide-react';
import { PrimaryButton } from './HomeUi';

export type InboxNote = {
  id: string;
  text: string;
  createdAt: string;
};

export default function HomeInbox({
  draft,
  notes,
  onDraftChange,
  onSave,
  onDelete,
  onSendToAssistant,
}: {
  draft: string;
  notes: InboxNote[];
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onSendToAssistant: (note: InboxNote) => void;
}) {
  return (
    <div className="px-4 pb-4">
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSave();
          }
        }}
        placeholder="记下想法、问题或待处理事项…"
        className="h-[84px] w-full resize-none rounded-xl border border-border/70 bg-background/70 p-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/45 focus:bg-background"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter 快速保存</span>
        <PrimaryButton onClick={onSave} disabled={!draft.trim()}>保存记录</PrimaryButton>
      </div>

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {notes.slice(0, 4).map((note) => (
            <li key={note.id} className="group flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 transition-colors hover:bg-muted">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/60" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground">{note.text}</span>
              <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => onSendToAssistant(note)}
                  title="交给助手处理"
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(note.id)}
                  title="删除"
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
