import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircleQuestion, Search } from 'lucide-react';

import MessageComponent from './MessageComponent';
import AgentTurnContainer from './AgentTurnContainer';
import ProviderSelectionEmptyState from './ProviderSelectionEmptyState';
import { Markdown } from './Markdown';
import type { ChatMessage, ChatStatus } from '../../types/types';
import type { Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import { isConversationFolderProject } from '../../../../utils/draftProject';
import AssistantThinkingIndicator from './AssistantThinkingIndicator';
import { createMessageKeyAllocator } from '../../utils/messageKeys';
import { groupMessagesIntoTurns, type GroupedItem } from '../../utils/groupAgentTurns';
import { getProviderDisplayName } from '../../utils/chatFormatting';
import { getProjectRootPath } from '../../utils/projectPathDisplay';
import SessionForkControl from './SessionForkControl';

interface ChatMessagesPaneProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  isLoadingMoreMessages: boolean;
  hasOlderMessages?: boolean;
  onLoadOlderMessages?: () => Promise<void>;
  visibleMessages: ChatMessage[];
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  isLoading: boolean;
  status?: ChatStatus | null;
  intakeGreeting?: string | null;
  newSessionMode?: SessionMode;
  onRetry?: () => void;
  onRewind?: () => void;
  onShareAssistantMessage?: (message: ChatMessage) => Promise<void>;
  onConsultSelection?: (selectedText: string) => void;
  onSearchSelection?: (selectedText: string) => void;
  onForkSessionCreated?: (session: ProjectSession & { __provider: SessionProvider }) => void;
}

type SelectionMenuState = {
  left: number;
  top: number;
  selectedText: string;
};

export function completedResponseOffsets(groupedItems: GroupedItem[]) {
  const completedResponseIndexes: number[] = [];
  groupedItems.forEach((item, index) => {
    if (item.kind === 'standalone' && item.message.type === 'assistant' && !item.message.isStreaming) {
      completedResponseIndexes.push(index);
    } else if (
      item.kind === 'agent-turn'
      && !item.isActivelyStreaming
      && item.allMessages.some((message) => message.type === 'assistant')
    ) {
      completedResponseIndexes.push(index);
    }
  });
  return new Map(completedResponseIndexes.map((itemIndex, responseIndex) => [
    itemIndex,
    completedResponseIndexes.length - responseIndex,
  ]));
}

export default function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  isLoadingMoreMessages,
  hasOlderMessages,
  onLoadOlderMessages,
  visibleMessages,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools,
  showRawParameters,
  showThinking,
  selectedProject,
  isLoading,
  status,
  intakeGreeting,
  newSessionMode = 'research',
  onRetry,
  onRewind,
  onShareAssistantMessage,
  onConsultSelection,
  onSearchSelection,
  onForkSessionCreated,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const messageKeyAllocatorRef = useRef<ReturnType<typeof createMessageKeyAllocator> | null>(null);
  if (!messageKeyAllocatorRef.current) {
    messageKeyAllocatorRef.current = createMessageKeyAllocator();
  }
  const projectRoot = getProjectRootPath(selectedProject);

  // Keep keys stable across prepends so existing MessageComponent instances retain local state.
  const getMessageKey = useCallback(
    (message: ChatMessage) => messageKeyAllocatorRef.current!(message),
    [],
  );

  const groupedItems = useMemo(
    () => groupMessagesIntoTurns(visibleMessages, isLoading),
    [visibleMessages, isLoading]
  );
  const persistedSessionId = selectedSession?.id || currentSessionId || '';
  const canForkSession = ['claude', 'codex', 'pi'].includes(provider)
    && Boolean(persistedSessionId)
    && !/^(?:new-session-|temp-)/.test(persistedSessionId);
  const responseOffsetByItemIndex = useMemo(
    () => completedResponseOffsets(groupedItems),
    [groupedItems],
  );
  const rewindableMessage = useMemo(() => {
    if (isLoading) {
      return null;
    }

    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      if (
        message.isToolUse ||
        message.isThinking ||
        message.isSkillContent ||
        typeof message.content !== 'string' ||
        message.content.trim().length === 0
      ) {
        continue;
      }

      return message.type === 'assistant' && !message.isStreaming && !message.isRewindNotice
        ? message
        : null;
    }

    return null;
  }, [isLoading, visibleMessages]);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(null);

  useEffect(() => {
    if (!selectionMenu) {
      return;
    }

    const closeMenu = () => setSelectionMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('scroll', closeMenu, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectionMenu]);

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onConsultSelection && !onSearchSelection) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('textarea, input, [contenteditable="true"]')) {
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    const root = scrollContainerRef.current;
    if (!selection || selection.rangeCount === 0 || !selectedText || !root) {
      setSelectionMenu(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;
    if (!commonAncestor || !root.contains(commonAncestor)) {
      setSelectionMenu(null);
      return;
    }

    event.preventDefault();
    const menuWidth = 220;
    const menuHeight = onConsultSelection && onSearchSelection ? 84 : 44;
    setSelectionMenu({
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      selectedText,
    });
  }, [onConsultSelection, onSearchSelection, scrollContainerRef]);

  return (
    <div
      ref={scrollContainerRef}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onContextMenu={handleContextMenu}
      className={`medical-chat-messages panel-scroll-area overflow-x-hidden px-0 py-3 sm:p-4 relative ${
        chatMessages.length === 0 && !selectedSession && !currentSessionId
          ? 'flex-shrink-0'
          : 'flex-1 overflow-y-auto'
      }`}
    >
      {/* Keep pagination feedback outside the spaced transcript so it never changes message positions. */}
      {isLoadingMoreMessages && chatMessages.length > 0 && (
        <div className="sticky top-2 z-20 flex h-0 justify-center overflow-visible pointer-events-none" role="status" aria-live="polite">
          <div className="flex items-center justify-center space-x-2 rounded-full border border-border/70 bg-background/95 px-3 py-1.5 text-gray-500 shadow-sm backdrop-blur dark:text-gray-400">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />
            <p className="text-sm">{t('session.loading.olderMessages')}</p>
          </div>
        </div>
      )}
      <div className="max-w-5xl mx-auto space-y-3 sm:space-y-4">
      {hasOlderMessages && onLoadOlderMessages && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => { void onLoadOlderMessages(); }}
            disabled={isLoadingSessionMessages || isLoadingMoreMessages}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {t('session.loading.loadOlderMessages')}
          </button>
        </div>
      )}
      {isLoadingSessionMessages && chatMessages.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
          <div className="flex items-center justify-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? (
        <>
          <ProviderSelectionEmptyState
            selectedSession={selectedSession}
            currentSessionId={currentSessionId}
            hasConnectedProjectFolder={isConversationFolderProject(selectedProject)}
          />
          {intakeGreeting && (
            <div className="flex flex-col w-full mb-6 mt-4">
              <div className="flex items-center space-x-2 mb-2">
                <div className="text-xs font-semibold text-gray-900 dark:text-white">
                  {getProviderDisplayName(provider)}
                </div>
              </div>
              <div className="w-full pl-0">
                <Markdown className="prose prose-md max-w-none dark:prose-invert prose-gray text-[15.5px] leading-relaxed" projectName={selectedProject?.name} projectRoot={projectRoot}>
                  {intakeGreeting}
                </Markdown>
              </div>
            </div>
          )}
          {/* Workspace QA guidance now lives in the composer placeholder. */}
        </>
      ) : (
        <>
          {groupedItems.map((item, index) => {
            const responseFromEnd = responseOffsetByItemIndex.get(index);
            const forkControl = canForkSession && responseFromEnd && onForkSessionCreated ? (
              <SessionForkControl
                projectName={selectedProject.name}
                sessionId={persistedSessionId}
                provider={provider}
                responseFromEnd={responseFromEnd}
                disabled={isLoading}
                onForked={onForkSessionCreated}
              />
            ) : null;
            if (item.kind === 'user' || item.kind === 'standalone') {
              return (
                <MessageComponent
                  key={getMessageKey(item.message)}
                  message={item.message}
                  index={index}
                  prevMessage={null}
                  createDiff={createDiff}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  onGrantToolPermission={onGrantToolPermission}
                  autoExpandTools={autoExpandTools}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  selectedProject={selectedProject}
                  provider={provider}
                  onRetry={onRetry}
                  onRewind={onRewind}
                  canRewind={item.message === rewindableMessage}
                  onShareAssistantMessage={onShareAssistantMessage}
                  forkControl={forkControl}
                />
              );
            }
            // kind === 'agent-turn'
            const turnAnchor = item.allMessages[0]
              || item.textMessages[0]
              || item.intermediateMessages[0];
            return (
              <AgentTurnContainer
                key={turnAnchor ? `agent-turn-${getMessageKey(turnAnchor)}` : `agent-turn-${index}`}
                turn={item}
                getMessageKey={getMessageKey}
                createDiff={createDiff}
                onFileOpen={onFileOpen}
                onShowSettings={onShowSettings}
                onGrantToolPermission={onGrantToolPermission}
                autoExpandTools={autoExpandTools}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                selectedProject={selectedProject}
                provider={provider}
                onRetry={onRetry}
                onRewind={onRewind}
                rewindableMessage={rewindableMessage}
                onShareAssistantMessage={onShareAssistantMessage}
                forkControl={forkControl}
              />
            );
          })}
        </>
      )}

      {isLoading && <AssistantThinkingIndicator selectedProvider={provider} status={status} />}
      </div>
      {selectionMenu && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[10020] min-w-[220px] overflow-hidden rounded-xl border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-2xl"
          style={{ left: selectionMenu.left, top: selectionMenu.top }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {onSearchSelection && (
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onSearchSelection(selectionMenu.selectedText);
              setSelectionMenu(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <Search className="h-4 w-4 text-primary" />
            <span>{t('selectionConsultation.search')}</span>
          </button>
          )}
          {onConsultSelection && (
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onConsultSelection?.(selectionMenu.selectedText);
              setSelectionMenu(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <MessageCircleQuestion className="h-4 w-4 text-primary" />
            <span>{t('selectionConsultation.contextMenu')}</span>
          </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
