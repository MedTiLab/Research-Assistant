import type { ChatMessage } from '../types/types';

export interface UserItem {
  kind: 'user';
  message: ChatMessage;
}

export interface StandaloneItem {
  kind: 'standalone';
  message: ChatMessage;
}

export interface AgentTurnItem {
  kind: 'agent-turn';
  textMessages: ChatMessage[];
  intermediateMessages: ChatMessage[];
  /** User-visible messages in original order (used for streaming flat view) */
  allMessages: ChatMessage[];
  toolCount: number;
  toolNames: string[];
  skillCount: number;
  skillNames: string[];
  isActivelyStreaming: boolean;
  durationSeconds?: number;
}

export type GroupedItem = UserItem | StandaloneItem | AgentTurnItem;

function extractSkillName(content: string): string | null {
  const commandMatch = content.match(/<command-name>([^<]+)<\/command-name>/i);
  if (commandMatch?.[1]?.trim()) {
    return commandMatch[1].trim();
  }

  const pathMatch = content.match(/Base directory for this skill:\s*(\S+)/i);
  if (pathMatch?.[1]) {
    return pathMatch[1].split(/[\\/]/).filter(Boolean).pop() || null;
  }

  const headingMatch = content.match(/^#\s+(.+)$/m);
  return headingMatch?.[1]?.trim() || null;
}

/**
 * Groups chat messages into agent turns.
 * Messages between two user messages form a single agent turn.
 * All pure-text assistant messages are extracted as `textMessages` and shown directly;
 * tool calls and thinking are `intermediateMessages` (collapsed by default).
 */
export function groupMessagesIntoTurns(
  messages: ChatMessage[],
  isLoading: boolean
): GroupedItem[] {
  const items: GroupedItem[] = [];
  let currentTurnMessages: ChatMessage[] = [];
  let currentTurnStartedAt: number | null = null;

  const getTimestampMs = (timestamp: ChatMessage['timestamp']) => {
    const value = new Date(timestamp).getTime();
    return Number.isFinite(value) ? value : null;
  };

  const getTurnCompletedAt = () => {
    let latestTimestamp: number | null = null;
    for (const message of currentTurnMessages) {
      const timestamp = getTimestampMs(message.timestamp);
      if (timestamp !== null && (latestTimestamp === null || timestamp > latestTimestamp)) {
        latestTimestamp = timestamp;
      }
    }
    return latestTimestamp;
  };

  const flushTurn = (isLastTurn: boolean) => {
    if (currentTurnMessages.length === 0) return;

    const activelyStreaming = isLastTurn && isLoading;
    const turnCompletedAt = activelyStreaming ? null : getTurnCompletedAt();
    const durationSeconds =
      currentTurnStartedAt !== null && turnCompletedAt !== null && turnCompletedAt >= currentTurnStartedAt
        ? Math.floor((turnCompletedAt - currentTurnStartedAt) / 1000)
        : undefined;

    // Skill payloads can contain an entire SKILL.md. Keep them in chat state for
    // runtime bookkeeping, but only pass their compact names/count into the UI.
    const skillMessages = currentTurnMessages.filter((message) => message.isSkillContent);
    const displayMessages = currentTurnMessages.filter((message) => !message.isSkillContent);
    const skillNames = Array.from(new Set(
      skillMessages
        .map((message) => extractSkillName(String(message.content || '')))
        .filter((name): name is string => Boolean(name)),
    ));

    // Find all assistant messages that are pure text (not tool use, not thinking-only)
    const isTextMessage = (msg: ChatMessage) =>
      msg.type === 'assistant' &&
      !msg.isToolUse &&
      !msg.isThinking &&
      msg.content &&
      msg.content.trim().length > 0;

    const textIndices = new Array<number>();
    for (let i = 0; i < displayMessages.length; i++) {
      if (isTextMessage(displayMessages[i])) {
        textIndices.push(i);
      }
    }

    const toolNames: string[] = [];
    const toolNamesSet = new Set<string>();
    let toolCount = 0;

    for (const msg of currentTurnMessages) {
      if (msg.isToolUse && msg.toolName) {
        toolCount++;
        if (!toolNamesSet.has(msg.toolName)) {
          toolNamesSet.add(msg.toolName);
          toolNames.push(msg.toolName);
        }
      }
    }

    // If there's only one message and it's a text message, standalone
    if (
      currentTurnMessages.length === 1 &&
      displayMessages.length === 1 &&
      textIndices.length === 1 &&
      textIndices[0] === 0 &&
      toolCount === 0 &&
      currentTurnStartedAt === null
    ) {
      items.push({ kind: 'standalone', message: displayMessages[0] });
      currentTurnMessages = [];
      currentTurnStartedAt = null;
      return;
    }

    // The last text message of the turn is extracted as textMessages (shown directly);
    // all others (intermediate thoughts, tool calls) are intermediateMessages (collapsed).
    const finalTextIndex = textIndices.length > 0 ? textIndices[textIndices.length - 1] : -1;
    
    const textMessages = [];
    const intermediateMessages = [];
    
    for (let i = 0; i < displayMessages.length; i++) {
      const msg = displayMessages[i];
      if (i === finalTextIndex) {
        textMessages.push(msg);
      } else {
        // If a message was originally a text message but isn't the final one,
        // we can optionally mark it as thinking for consistent UI treatment,
        // although keeping it as is will render it as normal text inside the collapsed block.
        if (isTextMessage(msg) && !msg.isSkillContent) {
          intermediateMessages.push({ ...msg, isThinking: true });
        } else {
          intermediateMessages.push(msg);
        }
      }
    }

    items.push({
      kind: 'agent-turn',
      textMessages,
      intermediateMessages,
      allMessages: [...displayMessages],
      toolCount,
      toolNames,
      skillCount: skillMessages.length,
      skillNames,
      isActivelyStreaming: activelyStreaming,
      durationSeconds,
    });

    currentTurnMessages = [];
    currentTurnStartedAt = null;
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type === 'user' && !msg.isSkillContent) {
      flushTurn(false);
      items.push({ kind: 'user', message: msg });
      currentTurnStartedAt = getTimestampMs(msg.timestamp);
    } else {
      currentTurnMessages.push(msg);
    }
  }

  // Flush remaining non-user messages as the last turn
  flushTurn(true);

  return items;
}
