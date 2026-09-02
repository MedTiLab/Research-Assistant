import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, ShieldCheck, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Project, SessionProvider } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { buildSelectionConsultationPrompt } from '../../utils/selectionConsultation';
import { decodeHtmlEntities } from '../../utils/chatFormatting';
import { createCachedDiffCalculator } from '../../utils/messageTransforms';
import type { ChatMessage } from '../../types/types';
import AssistantThinkingIndicator from './AssistantThinkingIndicator';
import MessageComponent from './MessageComponent';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  normalizeClaudeStoredModelSelection,
  normalizeCodexStoredModelSelection,
} from '../../../../../shared/modelConstants';

export type SelectionConsultationSeed = {
  id: string;
  selectedText: string;
  conversationContext: string;
  provider: 'claude' | 'codex';
};

interface SelectionConsultationPanelProps {
  seed: SelectionConsultationSeed;
  selectedProject: Project;
  provider: SessionProvider;
  claudeModel?: string;
  codexModel?: string;
  latestMessage: any;
  sendMessage: (message: unknown) => void;
  onClose: () => void;
}

const READ_ONLY_CLAUDE_TOOLS = ['Read', 'Glob', 'Grep'];
const MUTATING_CLAUDE_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'exit_plan_mode',
];

const createId = (prefix: string) => {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
};

const extractClaudeText = (data: any) => {
  if (data?.type === 'content_block_delta' && typeof data?.delta?.text === 'string') {
    return { content: data.delta.text, replace: false };
  }

  const content = data?.message?.content ?? data?.content;
  if (typeof content === 'string' && content.trim()) {
    return { content, replace: true };
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (text) {
      return { content: text, replace: true };
    }
  }
  return null;
};

export default function SelectionConsultationPanel({
  seed,
  selectedProject,
  provider,
  claudeModel,
  codexModel,
  latestMessage,
  sendMessage,
  onClose,
}: SelectionConsultationPanelProps) {
  const { t } = useTranslation('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const persistedSessionIdRef = useRef<string | null>(null);
  const clientSessionIdRef = useRef<string | null>(null);
  const knownSessionIdsRef = useRef<Set<string>>(new Set());
  const closeRequestedRef = useRef(false);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const consultationProviderRef = useRef<SessionProvider>(seed.provider || provider);
  const consultationProjectNameRef = useRef(selectedProject.name);
  const processedMessageRef = useRef<any>(null);
  const lastSeedIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const createDiff = useMemo(() => createCachedDiffCalculator(), []);
  const seedProvider = seed.provider || provider;
  const effectiveProvider: 'claude' | 'codex' = seedProvider === 'codex' ? 'codex' : 'claude';
  const effectiveClaudeModel = claudeModel || normalizeClaudeStoredModelSelection(
    typeof window !== 'undefined' ? window.localStorage.getItem('claude-model') : CLAUDE_MODELS.DEFAULT,
  );
  const effectiveCodexModel = codexModel || normalizeCodexStoredModelSelection(
    typeof window !== 'undefined' ? window.localStorage.getItem('codex-model') : CODEX_MODELS.DEFAULT,
  );

  const deleteAndClose = useCallback((persistedSessionId: string) => {
    if (cleanupPromiseRef.current) {
      return cleanupPromiseRef.current;
    }

    setIsClosing(true);
    setCloseError(null);
    const cleanup = (async () => {
      const response = await api.deleteConsultationSession(
        selectedProject.name,
        persistedSessionId,
        effectiveProvider,
      );
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      onClose();
    })().catch((error) => {
      cleanupPromiseRef.current = null;
      closeRequestedRef.current = false;
      setIsClosing(false);
      setCloseError(String(error?.message || t('selectionConsultation.cleanupError')));
    });

    cleanupPromiseRef.current = cleanup;
    return cleanup;
  }, [effectiveProvider, onClose, selectedProject.name, t]);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    closeRequestedRef.current = true;
    setIsClosing(true);
    setCloseError(null);

    const persistedSessionId = persistedSessionIdRef.current;
    if (persistedSessionId) {
      void deleteAndClose(persistedSessionId);
      return;
    }

    const activeSessionId = activeSessionIdRef.current;
    if (activeSessionId) {
      sendMessage({
        type: 'abort-session',
        sessionId: activeSessionId,
        provider: effectiveProvider,
        runtimeId: effectiveProvider,
        projectKey: selectedProject.name,
      });
      return;
    }

    onClose();
  }, [deleteAndClose, effectiveProvider, isClosing, onClose, selectedProject.name, sendMessage]);

  const appendAssistantText = useCallback((content: string, replace: boolean) => {
    if (!content) return;
    const decodedContent = decodeHtmlEntities(content);
    setMessages((previous) => {
      const next = [...previous];
      const last = next[next.length - 1];
      if (last?.type === 'assistant' && last.isStreaming) {
        next[next.length - 1] = {
          ...last,
          content: replace ? decodedContent : `${last.content || ''}${decodedContent}`,
        };
        return next;
      }
      next.push({
        consultationMessageId: createId('consultation-assistant'),
        type: 'assistant',
        content: decodedContent,
        timestamp: new Date(),
        isStreaming: true,
      });
      return next;
    });
  }, []);

  const upsertAssistantSnapshot = useCallback((content: string, itemId?: string, isComplete = false) => {
    if (!content.trim()) return;
    const decodedContent = decodeHtmlEntities(content);
    setMessages((previous) => {
      const existingIndex = itemId
        ? previous.findIndex((message) => message.codexItemId === itemId && message.type === 'assistant')
        : -1;
      if (existingIndex >= 0) {
        const next = [...previous];
        next[existingIndex] = {
          ...next[existingIndex],
          content: decodedContent,
          isStreaming: !isComplete,
        };
        return next;
      }
      return [
        ...previous,
        {
          consultationMessageId: createId('consultation-assistant'),
          codexItemId: itemId,
          type: 'assistant',
          content: decodedContent,
          timestamp: new Date(),
          isStreaming: !isComplete,
        },
      ];
    });
  }, []);

  const finishAssistantMessage = useCallback(() => {
    setMessages((previous) => previous.map((message, index) => (
      message.type === 'assistant' && message.isStreaming
        ? { ...message, isStreaming: false }
        : message
    )));
    setIsLoading(false);
  }, []);

  const sendConsultationCommand = useCallback((question: string, includeSeedContext: boolean) => {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || isLoading || closeRequestedRef.current) {
      return;
    }

    const currentSessionId = sessionId;
    const clientSessionId = currentSessionId
      ? (clientSessionIdRef.current || currentSessionId)
      : createId('new-session-consultation');
    if (!currentSessionId) {
      clientSessionIdRef.current = clientSessionId;
      activeSessionIdRef.current = clientSessionId;
      knownSessionIdsRef.current.add(clientSessionId);
    }

    const command = includeSeedContext
      ? buildSelectionConsultationPrompt(seed.selectedText, seed.conversationContext, normalizedQuestion)
      : buildSelectionConsultationPrompt(seed.selectedText, '', normalizedQuestion);
    const projectPath = selectedProject.fullPath || selectedProject.path || '';

    setMessages((previous) => [
      ...previous,
      {
        consultationMessageId: createId('consultation-user'),
        type: 'user',
        content: normalizedQuestion,
        timestamp: new Date(),
      },
    ]);
    setInput('');
    setIsLoading(true);

    if (effectiveProvider === 'codex') {
      sendMessage({
        type: 'agent-command',
        runtimeId: 'codex',
        projectKey: selectedProject.name,
        command,
        sessionId: currentSessionId,
        clientSessionId,
        options: {
          cwd: projectPath,
          projectPath,
          projectName: selectedProject.name,
          sessionId: currentSessionId,
          clientSessionId,
          resume: Boolean(currentSessionId),
          model: effectiveCodexModel,
          permissionMode: 'readOnly',
          sessionMode: 'consultation',
        },
      });
      return;
    }

    sendMessage({
      type: 'agent-command',
      runtimeId: 'claude',
      projectKey: selectedProject.name,
      command,
      clientSessionId,
      options: {
        projectPath,
        cwd: projectPath,
        projectName: selectedProject.name,
        sessionId: currentSessionId,
        resume: Boolean(currentSessionId),
        clientSessionId,
        toolsSettings: {
          allowedTools: READ_ONLY_CLAUDE_TOOLS,
          disallowedTools: MUTATING_CLAUDE_TOOLS,
          skipPermissions: false,
        },
        permissionMode: 'plan',
        model: effectiveClaudeModel,
        sessionMode: 'consultation',
      },
    });
  }, [effectiveClaudeModel, effectiveCodexModel, effectiveProvider, isLoading, seed, selectedProject, sendMessage, sessionId]);

  useEffect(() => {
    if (lastSeedIdRef.current === seed.id) {
      return;
    }

    if (lastSeedIdRef.current) {
      const previousPersistedSessionId = persistedSessionIdRef.current;
      const previousActiveSessionId = activeSessionIdRef.current;
      if (previousPersistedSessionId) {
        void api.deleteConsultationSession(
          consultationProjectNameRef.current,
          previousPersistedSessionId,
          consultationProviderRef.current,
        );
      } else if (previousActiveSessionId) {
        sendMessage({
          type: 'abort-session',
          sessionId: previousActiveSessionId,
          provider: consultationProviderRef.current,
          runtimeId: consultationProviderRef.current,
          projectKey: consultationProjectNameRef.current,
        });
      }
    }

    lastSeedIdRef.current = seed.id;
    consultationProviderRef.current = effectiveProvider;
    consultationProjectNameRef.current = selectedProject.name;
    processedMessageRef.current = null;
    activeSessionIdRef.current = null;
    persistedSessionIdRef.current = null;
    clientSessionIdRef.current = null;
    knownSessionIdsRef.current = new Set();
    closeRequestedRef.current = false;
    cleanupPromiseRef.current = null;
    setSessionId(null);
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setIsClosing(false);
    setCloseError(null);

    const timer = window.setTimeout(() => {
      sendConsultationCommand(t('selectionConsultation.initialQuestion'), true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [effectiveProvider, seed.id, selectedProject.name, sendConsultationCommand, sendMessage, t]);

  useEffect(() => {
    if (!latestMessage || processedMessageRef.current === latestMessage) {
      return;
    }
    processedMessageRef.current = latestMessage;

    if (latestMessage.type === 'session-created' && latestMessage.mode === 'consultation') {
      const previousSessionId = latestMessage.previousSessionId;
      if (
        latestMessage.provider === effectiveProvider
        && (!previousSessionId || knownSessionIdsRef.current.has(previousSessionId))
      ) {
        setSessionId(latestMessage.sessionId);
        persistedSessionIdRef.current = latestMessage.sessionId;
        activeSessionIdRef.current = latestMessage.sessionId;
        knownSessionIdsRef.current.add(latestMessage.sessionId);
        if (closeRequestedRef.current) {
          void deleteAndClose(latestMessage.sessionId);
        }
      }
      return;
    }

    const activeSessionId = activeSessionIdRef.current;
    if (
      !activeSessionId
      || (latestMessage.sessionId && !knownSessionIdsRef.current.has(latestMessage.sessionId))
    ) {
      return;
    }

    if (latestMessage.type === 'claude-response') {
      const extracted = extractClaudeText(latestMessage.data);
      if (extracted) {
        appendAssistantText(extracted.content, extracted.replace);
      }
      return;
    }

    if (latestMessage.type === 'codex-response') {
      const data = latestMessage.data;
      if (data?.type === 'item' && data.itemType === 'agent_message') {
        const content = data.message?.content;
        if (typeof content === 'string' && content.trim()) {
          upsertAssistantSnapshot(content, data.itemId, data.lifecycle === 'completed');
        }
      }
      return;
    }

    if (
      latestMessage.type === 'codex-response' && latestMessage.data?.type === 'status'
    ) {
      setIsLoading(true);
      return;
    }

    if (latestMessage.type === 'session-aborted') {
      finishAssistantMessage();
      return;
    }

    if (['claude-complete', 'codex-complete'].includes(latestMessage.type)) {
      finishAssistantMessage();
      if (closeRequestedRef.current && !persistedSessionIdRef.current) {
        onClose();
      }
      return;
    }

    if (['claude-error', 'codex-error'].includes(latestMessage.type)) {
      setMessages((previous) => [
        ...previous,
        {
          consultationMessageId: createId('consultation-error'),
          type: 'error',
          content: String(latestMessage.error || t('selectionConsultation.error')),
          timestamp: new Date(),
          isRetryable: false,
        },
      ]);
      setIsLoading(false);
      if (closeRequestedRef.current && !persistedSessionIdRef.current) {
        onClose();
      }
    }
  }, [appendAssistantText, deleteAndClose, effectiveProvider, finishAssistantMessage, latestMessage, onClose, t, upsertAssistantSnapshot]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, isLoading]);

  const abortConsultation = useCallback(() => {
    const activeSessionId = activeSessionIdRef.current;
    if (!activeSessionId) return;
    sendMessage({
      type: 'abort-session',
      sessionId: activeSessionId,
      provider: effectiveProvider,
      runtimeId: effectiveProvider,
      projectKey: selectedProject.name,
    });
  }, [effectiveProvider, selectedProject.name, sendMessage]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background/70">
      <div className="border-b border-border/70 bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{t('selectionConsultation.title')}</div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-emerald-600" />
              <span>{t('selectionConsultation.readOnly')}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isClosing}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
            title={t('selectionConsultation.close')}
          >
            {isClosing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="mt-2 line-clamp-3 border-l-2 border-primary/35 pl-3 text-xs leading-relaxed text-muted-foreground">
          {seed.selectedText}
        </div>
        {closeError ? (
          <p className="mt-2 text-xs text-destructive">
            {t('selectionConsultation.cleanupError')}: {closeError}
          </p>
        ) : null}
      </div>

      <div ref={scrollRef} className="medical-chat-messages panel-scroll-area flex-1 overflow-y-auto py-4">
        <div className="mx-auto w-full space-y-3">
          {messages.map((message, index) => (
            <MessageComponent
              key={String(message.consultationMessageId || message.codexItemId || index)}
              message={message}
              index={index}
              prevMessage={index > 0 ? messages[index - 1] : null}
              createDiff={createDiff}
              selectedProject={selectedProject}
              provider={effectiveProvider}
              showThinking={false}
              hideThinkingFold
            />
          ))}
          {isLoading && !messages.some((message) => message.type === 'assistant' && message.isStreaming) && (
            <div className="px-4 sm:px-6">
              <AssistantThinkingIndicator selectedProvider={effectiveProvider} />
            </div>
          )}
        </div>
      </div>

      <form
        className="border-t border-border bg-background p-3"
        onSubmit={(event) => {
          event.preventDefault();
          sendConsultationCommand(input, false);
        }}
      >
        <div className="medical-composer-card relative rounded-3xl border border-border/75 bg-card/80 shadow-sm backdrop-blur-sm transition-all focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendConsultationCommand(input, false);
              }
            }}
            disabled={isClosing}
            rows={2}
            className="block max-h-40 min-h-[68px] w-full resize-none rounded-3xl bg-transparent py-3 pl-4 pr-14 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
            placeholder={t('selectionConsultation.placeholder')}
          />
          <button
            type="submit"
            disabled={isClosing || (!isLoading && !input.trim())}
            onClick={(event) => {
              if (!isLoading) return;
              event.preventDefault();
              abortConsultation();
            }}
            className={`absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              isLoading
                ? 'border border-red-300/70 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-500/35 dark:bg-red-950/25 dark:text-red-300'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
            title={isLoading ? t('input.stop') : t('selectionConsultation.send')}
          >
            {isLoading ? <Square className="h-3.5 w-3.5 fill-current" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
