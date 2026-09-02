const REFERENCE_CHAT_DRAFT_PREFIX = 'medhelp-reference-chat-draft:';

export const REFERENCE_CHAT_DRAFT_EVENT = 'medhelp:reference-chat-draft';

export interface ReferenceChatDraft {
  text: string;
  referenceId: string;
  pdfCached: boolean;
}

const getDraftKey = (projectName: string) => `${REFERENCE_CHAT_DRAFT_PREFIX}${projectName}`;

export const queueReferenceChatDraft = (projectName: string, draft: ReferenceChatDraft) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getDraftKey(projectName), JSON.stringify(draft));
  window.dispatchEvent(new CustomEvent(REFERENCE_CHAT_DRAFT_EVENT, {
    detail: { projectName },
  }));
};

export const consumeReferenceChatDraft = (projectName: string): ReferenceChatDraft | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const key = getDraftKey(projectName);
  const raw = window.sessionStorage.getItem(key);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(key);
  try {
    return JSON.parse(raw) as ReferenceChatDraft;
  } catch {
    return null;
  }
};
