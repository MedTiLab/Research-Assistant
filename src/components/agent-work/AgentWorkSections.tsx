import { AlertCircle, CalendarClock, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AgentWorkDetails from './AgentWorkDetails';
import { agentStatusLabel } from './usePiSessionState';
import type { AgentWorkItem, AgentWorkSummary } from './useAgentWork';

type AgentWorkSectionsProps = {
  summary: AgentWorkSummary;
  isLoading?: boolean;
  compact?: boolean;
  onOpen: (item: AgentWorkItem) => void;
};

const GROUPS = [
  { key: 'active', label: 'Active', icon: LoaderCircle },
  { key: 'needsAttention', label: 'Needs attention', icon: AlertCircle },
  { key: 'scheduled', label: 'Scheduled', icon: CalendarClock },
  { key: 'recent', label: 'Recent', icon: CheckCircle2 },
] as const;

function itemTitle(item: AgentWorkItem) {
  return item.title || item.description || item.toolName || 'Agent run';
}

export default function AgentWorkSections({ summary, isLoading, compact = false, onOpen }: AgentWorkSectionsProps) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<AgentWorkItem | null>(null);
  const visibleGroups = GROUPS
    .map((group) => ({ ...group, items: summary[group.key] || [] }))
    .filter((group) => group.items.length > 0);

  if (visibleGroups.length === 0) {
    return isLoading
      ? <div className="px-3 py-2 text-xs text-muted-foreground">{zh ? '正在加载任务…' : 'Loading agent work…'}</div>
      : null;
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-2 border-b border-border/60 pb-2'}>
      {visibleGroups.map(({ key, label, icon: Icon, items }) => (
        <section key={key}>
          <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Icon className={`h-3.5 w-3.5 ${key === 'active' ? 'animate-spin' : ''}`} />
            <span>{zh ? ({ active: '正在运行', needsAttention: '需要处理', scheduled: '计划任务', recent: '最近完成' })[key] : label}</span>
            <span className="ml-auto tabular-nums">{items.length}</span>
          </div>
          <div className="space-y-0.5">
            {(expanded[key] ? items : items.slice(0, compact ? 3 : 5)).map((item, index) => (
              <button
                key={`${key}:${item.projectKey}:${item.sessionId}:${item.id || index}`}
                type="button"
                disabled={!item.sessionId}
                onClick={() => item.terminal || item.kind === 'task' ? setDetail(item) : onOpen(item)}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:cursor-default disabled:opacity-70"
              >
                <span className={`h-1.5 w-1.5 flex-none rounded-full ${
                  key === 'needsAttention' ? 'bg-amber-500' : key === 'active' ? 'bg-blue-500' : 'bg-muted-foreground/50'
                }`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-foreground">{itemTitle(item)}</span>
                  {item.status && <span className="block text-[10px] text-muted-foreground">{agentStatusLabel(item.status, zh)}</span>}
                  {item.schedule && <span className="block truncate text-[10px] text-muted-foreground">{Number.isFinite(Date.parse(item.schedule)) ? new Date(item.schedule).toLocaleString() : item.schedule}</span>}
                  {!compact && item.projectKey && (
                    <span className="block truncate text-[10px] text-muted-foreground">{item.projectKey}</span>
                  )}
                </span>
              </button>
            ))}
            {items.length > (compact ? 3 : 5) && <button type="button" className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setExpanded((previous) => ({ ...previous, [key]: !previous[key] }))}>
              {expanded[key] ? (zh ? '收起' : 'Show less') : (zh ? `查看全部 ${items.length} 项` : `Show all ${items.length}`)}
            </button>}
          </div>
        </section>
      ))}
      {detail && <AgentWorkDetails key={`${detail.projectKey}:${detail.sessionId}:${detail.id}`} item={detail} onClose={() => setDetail(null)} onOpen={onOpen} />}
    </div>
  );
}
