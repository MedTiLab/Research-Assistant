import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import MessageComponent from './MessageComponent';
import type { AgentTurnItem } from '../../utils/groupAgentTurns';
import type { ChatMessage } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { Provider } from '../../types/types';

interface AgentTurnContainerProps {
  turn: AgentTurnItem;
  getMessageKey: (message: ChatMessage) => string;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  provider: Provider | string;
  onRetry?: () => void;
  onRewind?: () => void;
  rewindableMessage?: ChatMessage | null;
  onShareAssistantMessage?: (message: ChatMessage) => Promise<void>;
  forkControl?: ReactNode;
}

export default function AgentTurnContainer({
  turn,
  getMessageKey,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
  onRetry,
  onRewind,
  rewindableMessage,
  onShareAssistantMessage,
  forkControl,
}: AgentTurnContainerProps) {
  const { t } = useTranslation('chat');

  const renderMessage = (
    message: ChatMessage,
    index: number,
    prevMessage: ChatMessage | null,
    hideThinkingFold?: boolean,
    turnDurationSeconds?: number,
    messageForkControl?: ReactNode,
  ) => (
    <MessageComponent
      key={getMessageKey(message)}
      message={message}
      index={index}
      prevMessage={prevMessage}
      createDiff={createDiff}
      onFileOpen={onFileOpen}
      onShowSettings={onShowSettings}
      onGrantToolPermission={onGrantToolPermission}
      autoExpandTools={autoExpandTools}
      showRawParameters={showRawParameters}
      showThinking={showThinking}
      hideThinkingFold={hideThinkingFold}
      selectedProject={selectedProject}
      provider={provider}
      onRetry={onRetry}
      onRewind={onRewind}
      canRewind={message === rewindableMessage}
      onShareAssistantMessage={onShareAssistantMessage}
      forkControl={messageForkControl}
      turnDurationSeconds={turnDurationSeconds}
    />
  );

  const skillSummary = turn.skillCount > 0
    ? `${t('agentTurn.usedSkills', { count: turn.skillCount })}${turn.skillNames.length > 0
      ? ` · ${turn.skillNames.slice(0, 2).join(', ')}${turn.skillNames.length > 2 ? ` +${turn.skillNames.length - 2}` : ''}`
      : ''}`
    : '';

  // Keep the provider's original order while streaming. Splitting all thinking
  // messages into one list and all other messages into another makes newly
  // arriving reasoning jump above already-rendered tool/text messages.
  if (turn.isActivelyStreaming) {
    return (
      <div className="medical-agent-turn space-y-1.5 sm:space-y-2">
        {skillSummary && (
          <div className="skill-activity-summary px-3 py-1 text-xs text-purple-600 dark:text-purple-400">
            {skillSummary}
          </div>
        )}
        {turn.allMessages.map((msg, i) =>
          renderMessage(msg, i, i > 0 ? turn.allMessages[i - 1] : null, false)
        )}
      </div>
    );
  }

  const hasIntermediate = turn.intermediateMessages.length > 0 || turn.skillCount > 0;

  // Build summary text
  const summaryParts: string[] = [];
  
  // Find a snippet of thinking context to show in the summary
  const firstThinking = turn.intermediateMessages.find(m => m.isThinking && m.content);
  if (firstThinking && firstThinking.content) {
    const textSnippet = firstThinking.content.trim().split('\n')[0];
    if (textSnippet) {
      summaryParts.push(`${t('agentTurn.thought')}: ${textSnippet.slice(0, 60)}${textSnippet.length > 60 ? '...' : ''}`);
    } else {
      summaryParts.push(t('agentTurn.thought'));
    }
  } else {
    summaryParts.push(t('agentTurn.thought'));
  }

  if (turn.toolCount > 0) {
    summaryParts.push(t('agentTurn.usedTools', { count: turn.toolCount }));
  }
  if (skillSummary) {
    summaryParts.push(skillSummary);
  }
  const summaryText = summaryParts.join(' · ');

  // When there are no text messages but there are intermediate messages,
  // show the last intermediate message uncollapsed as a fallback preview
  const fallbackPreview =
    turn.textMessages.length === 0 && turn.intermediateMessages.length > 0
      ? turn.intermediateMessages[turn.intermediateMessages.length - 1]
      : null;
  const collapsedMessages = fallbackPreview
    ? turn.intermediateMessages.slice(0, -1)
    : turn.intermediateMessages;
  const hasCollapsed = collapsedMessages.length > 0;

  return (
    <div className="medical-agent-turn space-y-3 sm:space-y-4">
      {hasCollapsed && (
        <details className="group">
          <summary className="cursor-pointer select-none list-none flex items-center gap-2 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg
              className="w-3.5 h-3.5 transition-transform group-open:rotate-90 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span>{summaryText}</span>
          </summary>
          <div className="mt-2 ml-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-1.5 sm:space-y-2">
            {collapsedMessages.map((msg, i) =>
              renderMessage(msg, i, i > 0 ? collapsedMessages[i - 1] : null, true)
            )}
          </div>
        </details>
      )}
      {!hasCollapsed && hasIntermediate && (
        <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
          <span>{summaryText}</span>
        </div>
      )}
      {fallbackPreview && renderMessage(fallbackPreview, 0, null, false, turn.durationSeconds, forkControl)}
      {turn.textMessages.map((msg, i) =>
        renderMessage(
          msg,
          i,
          i > 0 ? turn.textMessages[i - 1] : null,
          false,
          i === 0 ? turn.durationSeconds : undefined,
          i === turn.textMessages.length - 1 ? forkControl : undefined,
        )
      )}
    </div>
  );
}
