import type { AttachedPrompt } from '../components/chat/types/types';

const CHAT_PROMPT_DRAFT_PREFIX = 'medhelp-chat-prompt-draft:';

export const CHAT_PROMPT_DRAFT_EVENT = 'medhelp:chat-prompt-draft';

export interface ChatPromptDraft {
  input: string;
  attachedPrompt?: AttachedPrompt | null;
}

const getDraftKey = (projectName: string) => `${CHAT_PROMPT_DRAFT_PREFIX}${projectName}`;

const normalizeDraft = (draft: string | ChatPromptDraft): ChatPromptDraft => {
  if (typeof draft === 'string') {
    return {
      input: draft,
      attachedPrompt: null,
    };
  }

  return {
    input: typeof draft.input === 'string' ? draft.input : '',
    attachedPrompt: draft.attachedPrompt ?? null,
  };
};

export const queueChatPromptDraft = (projectName: string, prompt: string | ChatPromptDraft) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getDraftKey(projectName), JSON.stringify(normalizeDraft(prompt)));
  window.dispatchEvent(new CustomEvent(CHAT_PROMPT_DRAFT_EVENT, {
    detail: { projectName },
  }));
};

/**
 * 在切换到聊天页并挂载 Chat 之后再写入草稿，避免 React Strict Mode 双次挂载或标签切换时
 * 在未监听到事件的情况下就先 consume 掉 sessionStorage，导致输入框仍为空白。
 */
export const queueChatPromptDraftDeferred = (projectName: string, prompt: string | ChatPromptDraft) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.setTimeout(() => {
    queueChatPromptDraft(projectName, prompt);
  }, 0);
};

export const consumeChatPromptDraft = (projectName: string): ChatPromptDraft | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const key = getDraftKey(projectName);
  const rawDraft = window.sessionStorage.getItem(key);
  if (!rawDraft) {
    return null;
  }

  window.sessionStorage.removeItem(key);

  try {
    return normalizeDraft(JSON.parse(rawDraft) as ChatPromptDraft);
  } catch {
    return normalizeDraft(rawDraft);
  }
};
