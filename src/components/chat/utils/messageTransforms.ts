import type { AttachedPrompt, ChatAttachment, ChatMessage } from '../types/types';
import {
  buildAssistantMessages,
  decodeHtmlEntities,
  unescapeWithMathProtection,
} from './chatFormatting';
import { stripInternalContextPrefix } from '../../../utils/sessionFormatting';
import { isCodexInternalContextContent } from '../../../../shared/codexInternalNotices.js';
import { canonicalAgentToolName } from '../../../../shared/agentRuntimeEvents.js';
import { isSubagentComplete, subagentStatus } from '../../../../shared/agentToolPresentation.js';
import { extractVisibleUserContent } from '../../../../shared/visibleUserContent.js';

export interface DiffLine {
  type: 'added' | 'removed';
  content: string;
  lineNum: number;
}

export type DiffCalculator = (oldStr: string, newStr: string) => DiffLine[];



const FILE_NOTE_HEADER = '[Files available at the following paths]';
const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
]);
const PDF_ATTACHMENT_EXTENSION = '.pdf';
const GUIDED_PROMPT_PATTERNS = [
  /^请协助我完成“(?<scenario>[^”]+)”。[\s\S]*?我的任务：\s*/u,
  /^Please help me with "(?<scenario>[^"]+)"\.[\s\S]*?My task:\s*/u,
  /^请协助我完成“(?<scenario>[^”]+)”。[^。]*?技能：(?<skills>.+?)。\s*/u,
  /^Please help me with "(?<scenario>[^"]+)"\.[^.]*?skills(?: when helpful)?: (?<skills>.+?)\.\s*/u,
];

const getAttachmentNameFromPath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || filePath;
};

const getAttachmentKindFromPath = (filePath: string): ChatAttachment['kind'] => {
  const normalized = filePath.toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  const extension = lastDot >= 0 ? normalized.slice(lastDot) : '';

  if (IMAGE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (extension === PDF_ATTACHMENT_EXTENSION) {
    return 'pdf';
  }

  return 'file';
};

const extractInjectedAttachments = (value: string): { text: string; attachments: ChatAttachment[] } => {
  if (typeof value !== 'string' || !value.includes(FILE_NOTE_HEADER)) {
    return { text: value, attachments: [] };
  }

  const match = value.match(
    /(?:\r?\n){2}\[Files available at the following paths\]\r?\n(?<paths>(?:\d+\.\s+[^\r\n]+(?:\r?\n|$))+)/u,
  );

  if (!match?.groups?.paths) {
    return { text: value, attachments: [] };
  }

  const attachments = match.groups.paths
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^\d+\.\s+(?<path>.+)$/u)?.groups?.path?.trim() || '')
    .filter(Boolean)
    .map((filePath) => ({
      name: getAttachmentNameFromPath(filePath),
      kind: getAttachmentKindFromPath(filePath),
      path: filePath,
    }));

  return {
    text: `${value.slice(0, match.index)}${value.slice((match.index || 0) + match[0].length)}`.trim(),
    attachments,
  };
};

const extractInjectedGuidedPrompt = (
  value: string,
): { text: string; attachedPrompt?: AttachedPrompt } => {
  if (typeof value !== 'string' || !value.trim()) {
    return { text: value };
  }

  for (const pattern of GUIDED_PROMPT_PATTERNS) {
    const match = value.match(pattern);
    const scenarioTitle = match?.groups?.scenario?.trim();
    if (!match || !scenarioTitle) {
      continue;
    }

    return {
      text: value.slice(match[0].length).trimStart(),
      attachedPrompt: {
        scenarioId: `replayed-guided-prompt:${scenarioTitle}`,
        scenarioIcon: '🧭',
        scenarioTitle,
        promptText: match[0].trim(),
      },
    };
  }

  return { text: value };
};

const extractEmbeddedUserRequest = (rawText: string): string => {
  if (typeof rawText !== 'string' || !rawText) {
    return '';
  }

  const match = rawText.match(/User request:\s*([\s\S]*?)\s*$/i);
  return match?.[1]?.trim() || '';
};

const normalizeVisibleUserMessage = (rawText: string) => {
  const explicitlyVisibleText = extractVisibleUserContent(rawText);
  const hasExplicitVisibilityBoundary = explicitlyVisibleText !== null;
  const strippedText = stripInternalContextPrefix(rawText, false) || '';
  const text = hasExplicitVisibilityBoundary
    ? explicitlyVisibleText.trim()
    : (strippedText || extractEmbeddedUserRequest(rawText));
  const shouldSkip =
    !rawText.trim() ||
    (!hasExplicitVisibilityBoundary && (
      isCodexInternalContextContent(rawText) ||
      rawText.startsWith('<system-reminder>') ||
      text.startsWith('<system-reminder>') ||
      rawText.startsWith('Caveat:') ||
      text.startsWith('Caveat:') ||
      rawText.startsWith('This session is being continued from a previous') ||
      text.startsWith('This session is being continued from a previous') ||
      rawText.startsWith('[Request interrupted') ||
      text.startsWith('[Request interrupted')
    ));

  const isSkillRelated = !hasExplicitVisibilityBoundary && rawText.includes('Base directory for this skill:');
  const visibleText = isSkillRelated ? (text || rawText.trim()) : text;
  const rawInjectedAttachments = extractInjectedAttachments(rawText).attachments;
  const { text: textWithoutFileNote, attachments: visibleInjectedAttachments } = extractInjectedAttachments(visibleText);
  const attachments = [...rawInjectedAttachments, ...visibleInjectedAttachments].filter(
    (attachment, index, all) => all.findIndex((candidate) => candidate.path === attachment.path) === index,
  );
  const { text: normalizedVisibleText, attachedPrompt } = extractInjectedGuidedPrompt(textWithoutFileNote);

  return {
    attachments,
    attachedPrompt,
    hasVisibleMetadata: attachments.length > 0 || Boolean(attachedPrompt),
    isSkillRelated,
    normalizedVisibleText,
    shouldSkip,
  };
};

/**
 * Parse answers from AskUserQuestion tool_result content.
 * Format: 'User has answered your questions: "q1"="a1", "q2"="a2". You can now...'
 */
export const parseAskUserAnswers = (resultContent: string): Record<string, string> | null => {
  if (!resultContent || !resultContent.includes('User has answered your questions:')) {
    return null;
  }
  const answers: Record<string, string> = {};
  // Match "question"="answer" pairs
  const regex = /"([^"]+)"="([^"]+)"/g;
  let match;
  while ((match = regex.exec(resultContent)) !== null) {
    answers[match[1]] = match[2];
  }
  return Object.keys(answers).length > 0 ? answers : null;
};

/**
 * Merge parsed answers into a toolInput string (JSON) for AskUserQuestion.
 */
export const mergeAnswersIntoToolInput = (toolInput: string, answers: Record<string, string>): string => {
  try {
    const parsed = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
    return JSON.stringify({ ...parsed, answers }, null, 2);
  } catch {
    return toolInput;
  }
};

const normalizeToolInput = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatNestedCodexToolName = (name: string): string => {
  if (name === 'exec_command') return 'Bash';
  if (name === 'apply_patch') return 'ApplyPatch';
  if (name === 'update_plan') return 'TodoWrite';
  if (name === 'web__run') return 'WebSearch';

  const mcpMatch = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcpMatch) {
    return `${mcpMatch[1]}:${mcpMatch[2].replace(/__/g, ':')}`;
  }

  return name.replace(/__/g, ':');
};

const extractNestedToolArguments = (source: string, openingParenthesisIndex: number): string => {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = openingParenthesisIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingParenthesisIndex + 1, index).trim();
      }
    }
  }

  return '';
};

const normalizeCodexWrapperTools = (toolName: unknown, toolInput: unknown) => {
  const normalizedName = typeof toolName === 'string' ? toolName.trim() : '';
  const source = normalizeToolInput(toolInput);
  if (normalizedName !== 'exec' || !source) {
    return [{ toolName: normalizedName, toolInput: source }];
  }

  const nestedCalls = [...source.matchAll(/\btools\.([A-Za-z_$][\w$]*)\s*\(/g)];
  if (nestedCalls.length === 0) {
    return [{ toolName: normalizedName, toolInput: source }];
  }

  return nestedCalls.map((match) => {
    const nestedName = match[1];
    const openingParenthesisIndex = (match.index || 0) + match[0].lastIndexOf('(');
    const nestedArguments = extractNestedToolArguments(source, openingParenthesisIndex) || source;
    let visibleInput = nestedArguments;

    if (nestedName === 'exec_command') {
      try {
        const parsed = JSON.parse(nestedArguments);
        visibleInput = JSON.stringify({
          command: parsed.cmd || parsed.command || '',
          ...(parsed.workdir ? { workdir: parsed.workdir } : {}),
        });
      } catch {
        // Preserve the individual JavaScript argument when it is not JSON.
      }
    }

    return {
      toolName: formatNestedCodexToolName(nestedName),
      toolInput: visibleInput,
    };
  });
};


export const calculateDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const oldLines = (oldStr ?? '').split('\n');
  const newLines = (newStr ?? '').split('\n');

  // Use LCS alignment so insertions/deletions don't cascade into a full-file "changed" diff.
  const lcsTable: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        lcsTable[oldIndex][newIndex] = lcsTable[oldIndex + 1][newIndex + 1] + 1;
      } else {
        lcsTable[oldIndex][newIndex] = Math.max(
          lcsTable[oldIndex + 1][newIndex],
          lcsTable[oldIndex][newIndex + 1],
        );
      }
    }
  }

  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldLine === newLine) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (lcsTable[oldIndex + 1][newIndex] >= lcsTable[oldIndex][newIndex + 1]) {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex += 1;
      continue;
    }

    diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
    newIndex += 1;
  }

  while (oldIndex < oldLines.length) {
    diffLines.push({ type: 'removed', content: oldLines[oldIndex], lineNum: oldIndex + 1 });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    diffLines.push({ type: 'added', content: newLines[newIndex], lineNum: newIndex + 1 });
    newIndex += 1;
  }

  return diffLines;
};

export const createCachedDiffCalculator = (): DiffCalculator => {
  const cache = new Map<string, DiffLine[]>();

  return (oldStr: string, newStr: string) => {
    const key = JSON.stringify([oldStr, newStr]);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const calculated = calculateDiff(oldStr, newStr);
    cache.set(key, calculated);
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }
    return calculated;
  };
};

export const convertSessionMessages = (rawMessages: any[]): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const hiddenWrapperToolIds = new Set(
    rawMessages
      .filter((message) => message?.type === 'tool_use' && message?.toolName === 'wait')
      .map((message) => message.toolCallId || message.toolId)
      .filter(Boolean),
  );
  const toolResults = new Map<
    string,
    { content: unknown; isError: boolean; timestamp: Date; toolUseResult: unknown; subagentTools?: unknown[] }
  >();

  // Normalize provider message envelopes that may expose fields at either level.
  const getRole = (msg: any) => msg.role || msg.message?.role;
  const getContent = (msg: any) => msg.content || msg.message?.content;
  const findSubagentContainer = (parentToolUseId: string) => {
    for (let index = converted.length - 1; index >= 0; index -= 1) {
      const candidate = converted[index];
      if (!candidate.isSubagentContainer) continue;
      if (candidate.toolId === parentToolUseId || candidate.toolCallId === parentToolUseId) {
        return candidate;
      }
    }
    return null;
  };

  rawMessages.forEach((message) => {
    const role = getRole(message);
    const content = getContent(message);

    // Pi stores tool results as separate records, including when a result is
    // replayed before its call. Index them before constructing tool cards.
    for (const result of [message, ...Object.values(message.toolResults || {})] as any[]) {
      const toolCallId = result.toolCallId || result.toolId;
      if (result.type === 'tool_result' && toolCallId) {
        toolResults.set(toolCallId, {
          content: result.output ?? result.content ?? '', isError: Boolean(result.isError),
          timestamp: new Date(result.timestamp || Date.now()),
          toolUseResult: result.toolUseResult ?? result.details ?? null, subagentTools: result.subagentTools,
        });
      }
    }

    if (role === 'user' && Array.isArray(content)) {
      content.forEach((part: any) => {
        if (part.type !== 'tool_result') {
          return;
        }
        toolResults.set(part.tool_use_id, {
          content: part.content,
          isError: Boolean(part.is_error),
          timestamp: new Date(message.timestamp || Date.now()),
          toolUseResult: message.toolUseResult || null,
          subagentTools: message.subagentTools,
        });
      });
    }
  });

  rawMessages.forEach((message) => {
    const role = getRole(message);
    let content = getContent(message);

    if (role === 'user' && content) {
      let rawText = '';
      if (Array.isArray(content)) {
        const textParts: string[] = [];
        content.forEach((part: any) => {
          if (part.type === 'text') {
            textParts.push(decodeHtmlEntities(part.text));
          }
        });
        rawText = textParts.join('\n');
      } else if (typeof content === 'string') {
        rawText = decodeHtmlEntities(content);
      } else {
        rawText = decodeHtmlEntities(String(content));
      }
      const {
        attachments,
        attachedPrompt,
        hasVisibleMetadata,
        isSkillRelated,
        normalizedVisibleText,
        shouldSkip,
      } = normalizeVisibleUserMessage(rawText);

      // Check if this user message also contains tool_result parts
      const hasToolResults = Array.isArray(content) &&
        content.some((part: any) => part.type === 'tool_result');

      if (shouldSkip) {
        return;
      }

      // Parse <task-notification> blocks
      const taskNotifRegex = /<task-notification>\s*<task-id>([^<]*)<\/task-id>\s*<output-file>([^<]*)<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g;
      const taskNotifMatch = taskNotifRegex.exec(rawText);
      if (taskNotifMatch) {
        const taskId = taskNotifMatch[1]?.trim() || null;
        const outputFile = taskNotifMatch[2]?.trim() || null;
        const status = taskNotifMatch[3]?.trim() || 'completed';
        const summary = taskNotifMatch[4]?.trim() || 'Background task finished';
        converted.push({
          type: 'assistant',
          content: summary,
          timestamp: message.timestamp || new Date().toISOString(),
          isTaskNotification: true,
          taskStatus: status,
          taskId,
          taskOutputFile: outputFile,
        });
      } else if (isSkillRelated) {
        if (!normalizedVisibleText && !hasVisibleMetadata) {
          return;
        }
        const last = converted[converted.length - 1];
        if (
          last?.type === 'user' &&
          String(last.content || '') === unescapeWithMathProtection(normalizedVisibleText) &&
          !last.attachments?.length &&
          !last.attachedPrompt &&
          !hasVisibleMetadata
        ) {
          return;
        }
        converted.push({
          type: 'user',
          content: unescapeWithMathProtection(normalizedVisibleText),
          timestamp: message.timestamp || new Date().toISOString(),
          isSkillContent: true,
          ...(message.piEntryId ? { piEntryId: message.piEntryId } : {}),
          ...(message.attachmentDelivery ? { attachmentDelivery: message.attachmentDelivery } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(attachedPrompt ? { attachedPrompt } : {}),
        });
      } else {
        if (!normalizedVisibleText && !hasVisibleMetadata) {
          return;
        }
        const last = converted[converted.length - 1];
        if (
          last?.type === 'user' &&
          String(last.content || '') === unescapeWithMathProtection(normalizedVisibleText) &&
          !last.attachments?.length &&
          !last.attachedPrompt &&
          !hasVisibleMetadata
        ) {
          return;
        }
        converted.push({
          type: 'user',
          content: unescapeWithMathProtection(normalizedVisibleText),
          timestamp: message.timestamp || new Date().toISOString(),
          ...(message.piEntryId ? { piEntryId: message.piEntryId } : {}),
          ...(message.attachmentDelivery ? { attachmentDelivery: message.attachmentDelivery } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(attachedPrompt ? { attachedPrompt } : {}),
        });
      }
      return;
    }

    if (message.type === 'thinking' && content) {
      converted.push({
        type: 'assistant',
        content: unescapeWithMathProtection(typeof content === 'string' ? content : JSON.stringify(content)),
        timestamp: message.timestamp || new Date().toISOString(),
        isThinking: true,
      });
      return;
    }

    if (message.type === 'tool_use' && message.toolName) {
      const parentToolUseId = message.parentToolUseId || message.parent_tool_use_id;
      const toolCallId = message.toolCallId || message.toolId;
      if (message.toolName === 'wait') {
        return;
      }
      const normalizedTools = normalizeCodexWrapperTools(message.toolName, message.toolInput);
      if (parentToolUseId) {
        const parent = findSubagentContainer(String(parentToolUseId));
        if (parent) {
          const existingChildren = parent.subagentState?.childTools || [];
          const nestedChildren = normalizedTools.map((tool, nestedIndex) => ({
            toolId: String(
              normalizedTools.length > 1
                ? `${toolCallId || `tool_${existingChildren.length + 1}`}:${nestedIndex}`
                : toolCallId || `tool_${existingChildren.length + 1}`,
            ),
            toolName: tool.toolName,
            toolInput: tool.toolInput,
            toolResult: null,
            timestamp: new Date(message.timestamp || Date.now()),
          }));
          parent.subagentState = {
            childTools: [...existingChildren, ...nestedChildren],
            currentToolIndex: existingChildren.length + nestedChildren.length - 1,
            isComplete: false,
          };
          return;
        }
      }

      converted.push(...normalizedTools.map((tool, nestedIndex) => ({
        type: 'assistant' as const,
        content: '',
        timestamp: message.timestamp || new Date().toISOString(),
        isToolUse: true,
        toolName: tool.toolName,
        toolInput: tool.toolInput,
        toolId: normalizedTools.length > 1 ? `${toolCallId}:${nestedIndex}` : toolCallId,
        toolCallId,
      })));
      return;
    }

    if (message.type === 'tool_result') {
      if (hiddenWrapperToolIds.has(message.toolCallId || message.toolId)) {
        return;
      }
      const parentToolUseId = message.parentToolUseId || message.parent_tool_use_id;
      if (parentToolUseId && message.toolCallId) {
        const parent = findSubagentContainer(String(parentToolUseId));
        if (parent?.subagentState?.childTools) {
          const updatedChildren = parent.subagentState.childTools.map((child) => {
            if (child.toolId !== message.toolCallId) return child;
            return {
              ...child,
              toolResult: {
                content: message.output || '',
                isError: Boolean(message.isError),
              },
            };
          });
          parent.subagentState = {
            ...parent.subagentState,
            childTools: updatedChildren,
            currentToolIndex: Math.max(parent.subagentState.currentToolIndex, updatedChildren.length - 1),
            // Completing a child tool does not finish the delegated task.
            isComplete: parent.subagentState.isComplete,
          };
          return;
        }
      }

      for (let index = converted.length - 1; index >= 0; index -= 1) {
        const convertedMessage = converted[index];
        if (!convertedMessage.isToolUse || convertedMessage.toolResult) {
          continue;
        }
        const resultId = message.toolCallId || message.toolId;
        if (resultId && (convertedMessage.toolCallId === resultId || convertedMessage.toolId === resultId)) {
          convertedMessage.toolResult = {
            content: message.output ?? message.content ?? '',
            isError: Boolean(message.isError),
          };
          convertedMessage.toolError = Boolean(message.isError);
          if (convertedMessage.toolName === 'AskUserQuestion' && message.output) {
            const parsedAnswers = parseAskUserAnswers(String(message.output));
            if (parsedAnswers) {
              convertedMessage.toolInput = mergeAnswersIntoToolInput(
                convertedMessage.toolInput as string,
                parsedAnswers,
              );
            }
          }
          break;
        }
      }
      return;
    }

    if (role === 'assistant' && content) {
      if (Array.isArray(content)) {
        content.forEach((part: any) => {
          if (part.type === 'thinking' || part.type === 'reasoning') {
            const thinkingText = part.thinking || part.reasoning || part.text || '';
            if (thinkingText.trim()) {
              converted.push({
                type: 'assistant',
                content: unescapeWithMathProtection(thinkingText),
                timestamp: message.timestamp || new Date().toISOString(),
                isThinking: true,
              });
            }
            return;
          }

          if (part.type === 'text') {
            let text = part.text;
            if (typeof text === 'string') {
              text = unescapeWithMathProtection(text);
            }
            const ts = message.timestamp || new Date().toISOString();
            converted.push(...buildAssistantMessages(typeof text === 'string' ? text : String(text), ts).map((entry) => message.piEntryId ? { ...entry, piEntryId: message.piEntryId } : entry));
            return;
          }

          if (part.type === 'tool_use') {
            const toolResult = toolResults.get(part.id);
            const toolName = canonicalAgentToolName(part.name);
            const isSubagentContainer = toolName === 'Task';

            const childTools: import('../types/types').SubagentChildTool[] = [];
            if (isSubagentContainer && toolResult?.subagentTools && Array.isArray(toolResult.subagentTools)) {
              for (const tool of toolResult.subagentTools as any[]) {
                childTools.push({
                  toolId: tool.toolId,
                  toolName: tool.toolName,
                  toolInput: tool.toolInput,
                  toolResult: tool.toolResult || null,
                  timestamp: new Date(tool.timestamp || Date.now()),
                });
              }
            }

            let finalToolInput = normalizeToolInput(part.input);
            if (part.name === 'AskUserQuestion' && toolResult) {
              const resultStr = typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content);
              const parsedAnswers = parseAskUserAnswers(resultStr);
              if (parsedAnswers) {
                finalToolInput = mergeAnswersIntoToolInput(finalToolInput, parsedAnswers);
              }
            }

            converted.push({
              type: 'assistant',
              content: '',
              timestamp: message.timestamp || new Date().toISOString(),
              isToolUse: true,
              toolName,
              toolInput: finalToolInput,
              ...(part.nativeToolName ? { nativeToolName: part.nativeToolName, nativeToolInput: part.nativeToolInput } : {}),
              toolId: part.id,
              toolCallId: part.id,
              toolResult: toolResult
                ? {
                    content:
                      typeof toolResult.content === 'string'
                        ? toolResult.content
                        : JSON.stringify(toolResult.content),
                    isError: toolResult.isError,
                    toolUseResult: toolResult.toolUseResult,
                  }
                : null,
              toolError: toolResult?.isError || false,
              toolResultTimestamp: toolResult?.timestamp || new Date(),
              isSubagentContainer,
              subagentState: isSubagentContainer
                ? {
                    childTools,
                    currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                    isComplete: isSubagentComplete(toolResult),
                    status: subagentStatus(toolResult),
                  }
                : undefined,
            });
          }
        });
        return;
      }

      if (typeof content === 'string') {
        const normalizedContent = unescapeWithMathProtection(content);
        const ts = message.timestamp || new Date().toISOString();
        converted.push(...buildAssistantMessages(normalizedContent, ts));
      }
    }
  });

  const signatureOccurrences = new Map<string, number>();
  return converted.map((message) => {
    if (
      message.id
      || message.messageId
      || message.toolId
      || message.toolCallId
      || message.blobId
      || message.rowid
      || message.sequence
    ) {
      return message;
    }

    const signature = JSON.stringify([
      message.type,
      message.timestamp,
      message.content,
      Boolean(message.isThinking),
      Boolean(message.isToolUse),
      message.toolName || '',
    ]);
    let hash = 2166136261;
    for (let index = 0; index < signature.length; index += 1) {
      hash ^= signature.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const baseId = `persisted-${(hash >>> 0).toString(36)}`;
    const occurrence = signatureOccurrences.get(baseId) || 0;
    signatureOccurrences.set(baseId, occurrence + 1);
    return {
      ...message,
      messageId: occurrence === 0 ? baseId : `${baseId}-${occurrence}`,
    };
  });
};
