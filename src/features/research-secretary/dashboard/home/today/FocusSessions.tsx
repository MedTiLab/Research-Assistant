import { Focus, Trash2 } from 'lucide-react';
import type { WorkbenchFocusSession } from '../../../domain/types';
import { EmptyHint } from '../HomeUi';
import { formatDuration } from './CheckInSegments';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function sortFocusSessions(sessions: WorkbenchFocusSession[]) {
  return [...sessions].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

export function totalFocusMinutes(sessions: WorkbenchFocusSession[]) {
  return sessions.reduce((sum, session) => sum + Math.max(0, session.minutes || 0), 0);
}

type Props = {
  sessions: WorkbenchFocusSession[];
  busy?: boolean;
  onDelete?: (id: string) => void;
};

export default function FocusSessions({ sessions, busy = false, onDelete }: Props) {
  const ordered = sortFocusSessions(sessions);

  if (ordered.length === 0) {
    return (
      <EmptyHint
        icon={<Focus className="h-4 w-4" />}
        title="今天还没有专注记录"
        description="完成一轮番茄后会在这里留下任务名和时长。"
        className="py-5"
      />
    );
  }

  return (
    <ul className="space-y-1.5">
      {ordered.map((session, index) => (
        <li
          key={session.id}
          className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2"
        >
          <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {session.taskTitle?.trim() || '未命名专注'}
            </span>
            <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
              {formatTime(session.createdAt)}
              <span className="mx-1.5 text-border">·</span>
              {formatDuration(session.minutes)}
            </span>
          </span>
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              aria-label={`删除第 ${index + 1} 段专注`}
              onClick={() => onDelete(session.id)}
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
