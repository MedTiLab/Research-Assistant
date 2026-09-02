type RealtimeMessage = Record<string, any>;

const TEXT_DELTA_MESSAGE_TYPES = new Set(['claude-response']);

const haveSameSession = (left: RealtimeMessage, right: RealtimeMessage) =>
  (left.sessionId || null) === (right.sessionId || null)
  && (left.projectName || left.projectKey || null) === (right.projectName || right.projectKey || null)
  && (left.sessionKey || null) === (right.sessionKey || null);

const isCumulativeAgentSnapshot = (message: RealtimeMessage) => (
  message.type === 'codex-response'
  && message.data?.type === 'item'
  && Boolean(message.data?.itemId)
  && (message.data?.itemType === 'agent_message' || message.data?.itemType === 'reasoning')
);

/**
 * Collapse adjacent high-frequency streaming updates before React consumes them.
 * Ordering is preserved: only messages that describe the same in-flight item are
 * combined, and lifecycle/tool boundaries remain separate queue entries.
 */
export const mergeAdjacentRealtimeMessages = (
  previous: RealtimeMessage,
  next: RealtimeMessage,
): RealtimeMessage | null => {
  if (!previous || !next || previous.type !== next.type || !haveSameSession(previous, next)) {
    return null;
  }

  if (next.type === 'pi-response') {
    const left = previous.data;
    const right = next.data;
    if (['text_delta', 'thinking_delta'].includes(right?.event)
      && left?.event === right.event
      && left?.data?.messageId === right.data?.messageId
      && typeof left?.data?.text === 'string' && typeof right?.data?.text === 'string') {
      return { ...next, data: { ...right, data: { ...right.data, text: left.data.text + right.data.text } } };
    }
  }

  if (TEXT_DELTA_MESSAGE_TYPES.has(String(next.type))) {
    const previousData = previous.data;
    const nextData = next.data;
    const previousText = previousData?.type === 'content_block_delta'
      ? previousData?.delta?.text
      : null;
    const nextText = nextData?.type === 'content_block_delta'
      ? nextData?.delta?.text
      : null;
    const sameParentTool = (previousData?.parentToolUseId || null) === (nextData?.parentToolUseId || null);

    if (typeof previousText === 'string' && typeof nextText === 'string' && sameParentTool) {
      return {
        ...previous,
        ...next,
        data: {
          ...previousData,
          ...nextData,
          delta: {
            ...previousData.delta,
            ...nextData.delta,
            text: `${previousText}${nextText}`,
          },
        },
      };
    }
  }

  if (next.type === 'codex-response') {
    const previousData = previous.data;
    const nextData = next.data;
    const sameItem = previousData?.itemId
      && previousData.itemId === nextData?.itemId
      && previousData.type === nextData?.type
      && previousData.itemType === nextData?.itemType;

    // Codex agent-message updates contain the full text accumulated so far, so
    // the newest pending update supersedes the older one. The same applies to
    // repeated reasoning/status updates for a single SDK item.
    if (
      sameItem
      && (
        nextData.itemType === 'agent_message'
        || nextData.itemType === 'reasoning'
        || nextData.type === 'status'
      )
    ) {
      return next;
    }
  }

  return null;
};

export const enqueueRealtimeMessage = (
  queue: RealtimeMessage[],
  message: RealtimeMessage,
) => {
  const lastIndex = queue.length - 1;
  if (lastIndex >= 0) {
    const merged = mergeAdjacentRealtimeMessages(queue[lastIndex], message);
    if (merged) {
      queue[lastIndex] = merged;
      return;
    }
  }

  // Codex agent updates contain the full accumulated text. A project or
  // status notification may arrive between two snapshots, so adjacent-only
  // merging still allows a large stale-text backlog to build. Remove an older
  // pending snapshot for the same item and retain the newest one at its real
  // position in the stream; lifecycle and tool messages remain untouched.
  if (isCumulativeAgentSnapshot(message)) {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const pending = queue[index];
      if (
        isCumulativeAgentSnapshot(pending)
        && pending.type === message.type
        && haveSameSession(pending, message)
        && pending.data?.itemId === message.data.itemId
      ) {
        queue.splice(index, 1);
        break;
      }
    }
  }

  queue.push(message);
};
