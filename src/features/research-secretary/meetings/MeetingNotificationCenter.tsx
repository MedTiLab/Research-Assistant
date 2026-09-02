import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { authenticatedFetch } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import Tooltip from '../../../components/Tooltip';
import { cn } from '../../../lib/utils';

interface MeetingReminder {
  id: string;
  sourceType: 'meeting' | 'action';
  sourceId: string;
  reminderKey: string;
  scheduledFor: string;
  title: string;
  body: string;
  deliveredAt?: string;
  readAt?: string;
}

export type MeetingNotificationVariant = 'rail' | 'footer' | 'footer-mobile';

const TRIGGER_CLASS: Record<MeetingNotificationVariant, string> = {
  rail: 'relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground',
  footer: 'relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
  'footer-mobile': 'relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground transition-all hover:bg-muted/60 active:scale-[0.98]',
};

const PANEL_CLASS: Record<MeetingNotificationVariant, string> = {
  rail: 'absolute bottom-0 left-full z-[80] ml-2',
  footer: 'absolute bottom-full left-0 z-[80] mb-2',
  'footer-mobile': 'absolute bottom-full left-0 z-[80] mb-2',
};

export default function MeetingNotificationCenter({
  variant = 'footer',
}: {
  variant?: MeetingNotificationVariant;
}) {
  const { latestMessage } = useWebSocket();
  const [open, setOpen] = useState(false);
  const [reminders, setReminders] = useState<MeetingReminder[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = useMemo(() => reminders.filter((item) => !item.readAt).length, [reminders]);

  useEffect(() => {
    let active = true;
    void authenticatedFetch('/api/research/reminders?limit=30')
      .then(async (response) => (response.ok ? response.json() : { reminders: [] }))
      .then((payload) => {
        if (active && Array.isArray(payload.reminders)) setReminders(payload.reminders);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (latestMessage?.type !== 'meeting-reminder' || !latestMessage.reminder?.id) return;
    const incoming = {
      ...latestMessage.reminder,
      deliveredAt: latestMessage.timestamp || new Date().toISOString(),
    } as MeetingReminder;
    setReminders((current) => [incoming, ...current.filter((item) => item.id !== incoming.id)].slice(0, 30));
  }, [latestMessage]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const markAllRead = async () => {
    const readAt = new Date().toISOString();
    setReminders((current) => current.map((item) => (item.readAt ? item : { ...item, readAt })));
    await authenticatedFetch('/api/research/reminders/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) void markAllRead();
  };

  const trigger = (
    <button
      type="button"
      aria-label="科研秘书通知"
      title="科研秘书通知"
      onClick={toggle}
      className={TRIGGER_CLASS[variant]}
    >
      <Bell className={variant === 'rail' ? 'h-5 w-5' : 'h-4 w-4'} strokeWidth={variant === 'rail' ? 1.85 : 2} />
      {unreadCount > 0 && (
        <span className="absolute right-1 top-1 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center justify-center">
      {variant === 'rail' ? (
        <Tooltip content="科研秘书通知" position="right" delay={120}>
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {open && (
        <div className={cn(PANEL_CLASS[variant], 'w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl')}>
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <div className="text-sm font-semibold">科研秘书通知</div>
            <CheckCheck className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {reminders.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无提醒</div>
            ) : (
              reminders.map((item) => (
                <div key={item.id} className="border-b border-border/50 px-4 py-3 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="shrink-0 text-[10px] text-muted-foreground">
                      {item.deliveredAt
                        ? new Date(item.deliveredAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : ''}
                    </div>
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
