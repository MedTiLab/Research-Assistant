import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, ChevronDown, ChevronRight, FilePenLine, Loader2, LockKeyhole, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useEntitlements, CAPABILITIES } from '../../../../hooks/useEntitlements';
import { api } from '../../../../utils/api';
import { useWebSocket } from '../../../../contexts/WebSocketContext';
import type { ChatMessage } from '../../types/types';

type ConversationMemoryPanelProps = {
  projectName: string;
  projectPath: string;
  messages: ChatMessage[];
  collapsed: boolean;
  onToggle: () => void;
  onSummarize?: () => void;
  onFileOpen?: (filePath: string) => void;
};

type ProjectMemoryFile = {
  exists: boolean;
  relativePath: string;
  updatedAt: string | null;
};

function hasConversationContent(messages: ChatMessage[]) {
  return messages.some((message) => (
    (message.type === 'user' || message.type === 'assistant')
    && typeof message.content === 'string'
    && Boolean(message.content.trim())
    && !message.isThinking
    && !message.isStreaming
  ));
}

export default function ConversationMemoryPanel({
  projectName,
  projectPath,
  messages,
  collapsed,
  onToggle,
  onSummarize,
  onFileOpen,
}: ConversationMemoryPanelProps) {
  const { t } = useTranslation('chat');
  const { latestMessage } = useWebSocket();
  const { can } = useEntitlements();
  const canUseMemory = can(CAPABILITIES.projectMemorySummary);
  const canSummarize = canUseMemory && hasConversationContent(messages) && Boolean(onSummarize);
  const [memoryFile, setMemoryFile] = useState<ProjectMemoryFile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    if (
      latestMessage?.type === 'project-memory-updated'
      && (
        latestMessage.projectName === projectName
        || latestMessage.projectPath === projectPath
      )
    ) {
      setRefreshRevision((revision) => revision + 1);
    }
  }, [latestMessage, projectName, projectPath]);

  useEffect(() => {
    let cancelled = false;

    if (!canUseMemory || !projectName) {
      setMemoryFile(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const loadMemoryFile = async () => {
      setIsLoading(true);
      try {
        const response = await api.medLibrary.projectMemoryFile(projectName);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (!cancelled) {
          setMemoryFile(payload?.memory ?? null);
        }
      } catch {
        if (!cancelled) {
          setMemoryFile(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadMemoryFile();
    return () => {
      cancelled = true;
    };
  }, [canUseMemory, projectName, refreshRevision]);

  const memoryOpenPath = useMemo(() => {
    const relativePath = memoryFile?.relativePath || '.medhelpsec/MEMORY.md';
    const normalizedRoot = projectPath.replace(/[\\/]+$/, '');
    return normalizedRoot ? `${normalizedRoot}/${relativePath}` : relativePath;
  }, [memoryFile?.relativePath, projectPath]);

  const openMemoryFile = () => {
    onFileOpen?.(memoryOpenPath);
  };

  return (
    <section className="rounded-xl border border-violet-200/70 bg-gradient-to-b from-violet-50/45 via-background to-background p-3.5 dark:border-violet-900/45 dark:from-violet-950/10">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-violet-200/80 bg-violet-50/95 text-violet-700 shadow-sm dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-200">
            <BrainCircuit className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-[0.08em] text-foreground">
            {t('sessionContext.memory.title')}
          </span>
          {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {!collapsed && canUseMemory ? (
          <button
            type="button"
            onClick={onSummarize}
            disabled={!canSummarize}
            className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[11px] font-semibold text-violet-700 shadow-sm transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200 dark:hover:bg-violet-950/50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('sessionContext.memory.actions.summarize')}
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="mt-3 space-y-2 border-t border-violet-200/60 pt-3 dark:border-violet-900/40">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('sessionContext.memory.messages.loading')}
            </div>
          ) : (
            <button
              type="button"
              onClick={openMemoryFile}
              disabled={!onFileOpen}
              aria-label="MEMORY.md"
              className="group w-full rounded-lg border border-border/60 bg-gradient-to-r from-background via-background to-muted/20 px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-900/40"
            >
              <div className="flex items-center justify-between gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold leading-5 text-foreground">MEMORY.md</div>
                </div>
                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/95 text-muted-foreground shadow-sm transition-colors group-hover:text-foreground">
                  <FilePenLine className="h-3 w-3" />
                </span>
              </div>
            </button>
          )}
          {!canUseMemory ? (
            <div className="flex items-start gap-2 rounded-lg border border-violet-200/70 bg-violet-50/70 px-3 py-2.5 text-[11px] leading-5 text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-200">
              <LockKeyhole className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{t('sessionContext.memory.messages.proLocked')}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
