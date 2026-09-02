import { stripInternalContextPrefix } from './sessionFormatting.js';
import {
  isCodexInternalContextContent,
  isCodexInternalPromptContent,
} from '../../shared/codexInternalNotices.js';
import { extractVisibleUserContent } from '../../shared/visibleUserContent.js';

const MAX_VISIBLE_MESSAGES = 1000;
const MAX_MESSAGE_CHARACTERS = 100_000;
const MAX_CONVERSATION_CHARACTERS = 2_000_000;

function extractTextFromContent(content, { includeThinking = false } = {}) {
  if (content === null || content === undefined) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (!part || typeof part !== 'object') {
        return '';
      }
      if (!includeThinking && (part.type === 'thinking' || part.type === 'reasoning')) {
        return '';
      }
      if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
        return part.text || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function stripInjectedFileNotes(value) {
  if (typeof value !== 'string' || !value.includes('[Files available at the following paths]')) {
    return value;
  }

  return value.replace(
    /(?:\r?\n){2}\[Files available at the following paths\]\r?\n(?:\d+\.\s+.+(?:\r?\n|$))+[\s]*$/u,
    '',
  );
}

function extractEmbeddedUserRequest(rawText) {
  if (typeof rawText !== 'string' || !rawText) {
    return '';
  }

  const match = rawText.match(/User request:\s*([\s\S]*?)\s*$/i);
  return match?.[1]?.trim() || '';
}

function isSkillInstructionContent(rawText) {
  if (typeof rawText !== 'string') {
    return false;
  }

  const cleaned = rawText.trim();
  return (
    /Base directory for this skill:\s*\S+/i.test(cleaned)
    || /^<command-(?:name|message|args)>/i.test(cleaned)
    || /^<local-command-stdout>/i.test(cleaned)
  );
}

function normalizeVisibleUserText(rawText) {
  if (isCodexInternalContextContent(rawText)) {
    return '';
  }

  const explicitlyVisibleText = extractVisibleUserContent(rawText);
  const hasExplicitVisibilityBoundary = explicitlyVisibleText !== null;
  const strippedText = stripInternalContextPrefix(rawText, false) || '';
  const text = hasExplicitVisibilityBoundary
    ? explicitlyVisibleText.trim()
    : (strippedText || extractEmbeddedUserRequest(rawText));
  const cleaned = stripInjectedFileNotes(text).trim();

  if (
    !cleaned
    || (!hasExplicitVisibilityBoundary && (
      rawText.trim().startsWith('<system-reminder>')
      || cleaned.startsWith('<system-reminder>')
      || rawText.trim().startsWith('Caveat:')
      || cleaned.startsWith('Caveat:')
      || rawText.trim().startsWith('This session is being continued from a previous')
      || cleaned.startsWith('This session is being continued from a previous')
      || rawText.trim().startsWith('[Request interrupted')
      || cleaned.startsWith('[Request interrupted')
    ))
  ) {
    return '';
  }

  return cleaned;
}

function normalizeTimestamp(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function getRawMessageRole(message) {
  return message?.role || message?.message?.role || (
    message?.type === 'user' || message?.type === 'assistant' ? message.type : null
  );
}

function getRawMessageContent(message) {
  if (message?.content !== undefined) {
    return message.content;
  }
  return message?.message?.content;
}

function buildVisibleConversationMessages(rawMessages = []) {
  const visibleMessages = [];

  for (const rawMessage of rawMessages) {
    const role = getRawMessageRole(rawMessage);
    const content = getRawMessageContent(rawMessage);
    const timestamp = normalizeTimestamp(rawMessage?.timestamp);
    const rawText = extractTextFromContent(content);

    if (role === 'system' || rawMessage?.type === 'thinking') {
      continue;
    }

    if (isSkillInstructionContent(rawText)) {
      continue;
    }

    if (role === 'user') {
      const text = normalizeVisibleUserText(rawText);
      if (!text) {
        continue;
      }
      visibleMessages.push({ role: 'user', content: text.slice(0, MAX_MESSAGE_CHARACTERS), timestamp });
      continue;
    }

    if (role === 'assistant') {
      const text = rawText.trim();
      if (!text || isCodexInternalPromptContent(text)) {
        continue;
      }
      visibleMessages.push({ role: 'assistant', content: text.slice(0, MAX_MESSAGE_CHARACTERS), timestamp });
    }
  }

  const cappedMessages = visibleMessages.slice(-MAX_VISIBLE_MESSAGES);
  let totalCharacters = 0;
  const retainedMessages = [];
  for (let index = cappedMessages.length - 1; index >= 0; index -= 1) {
    const message = cappedMessages[index];
    if (retainedMessages.length > 0 && totalCharacters + message.content.length > MAX_CONVERSATION_CHARACTERS) {
      break;
    }
    const remaining = Math.max(0, MAX_CONVERSATION_CHARACTERS - totalCharacters);
    retainedMessages.push({ ...message, content: message.content.slice(-remaining) });
    totalCharacters += Math.min(message.content.length, remaining);
    if (totalCharacters >= MAX_CONVERSATION_CHARACTERS) {
      break;
    }
  }

  return retainedMessages.reverse();
}

export {
  buildVisibleConversationMessages,
  extractTextFromContent,
  isSkillInstructionContent,
  normalizeTimestamp,
  normalizeVisibleUserText,
};
