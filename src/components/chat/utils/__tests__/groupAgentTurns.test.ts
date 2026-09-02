import { describe, expect, it } from 'vitest';
import { groupMessagesIntoTurns } from '../groupAgentTurns';
import type { ChatMessage } from '../../types/types';

describe('groupMessagesIntoTurns', () => {
  it('keeps a lone assistant message standalone when no user turn started it', () => {
    const messages: ChatMessage[] = [
      { type: 'assistant', content: 'Hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ];

    expect(groupMessagesIntoTurns(messages, false)).toEqual([
      { kind: 'standalone', message: messages[0] },
    ]);
  });

  it('keeps single assistant replies in agent turns so completed duration can be shown', () => {
    const messages: ChatMessage[] = [
      { type: 'user', content: 'Run this', timestamp: '2026-01-01T00:00:00.000Z' },
      { type: 'assistant', content: 'Done', timestamp: '2026-01-01T00:02:51.000Z' },
    ];

    const items = groupMessagesIntoTurns(messages, false);

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      kind: 'agent-turn',
      textMessages: [messages[1]],
      durationSeconds: 171,
    });
  });

  it('summarizes skill payloads without passing their full bodies to the renderer', () => {
    const skillMessage: ChatMessage = {
      type: 'user',
      content: '<command-name>peer-review</command-name>\nBase directory for this skill: /private/skills/peer-review\nFull skill body',
      timestamp: '2026-01-01T00:00:01.000Z',
      isSkillContent: true,
    };
    const answer: ChatMessage = {
      type: 'assistant',
      content: 'Review complete',
      timestamp: '2026-01-01T00:00:02.000Z',
    };

    const items = groupMessagesIntoTurns([
      { type: 'user', content: 'Review this', timestamp: '2026-01-01T00:00:00.000Z' },
      skillMessage,
      answer,
    ], false);

    expect(items[1]).toMatchObject({
      kind: 'agent-turn',
      skillCount: 1,
      skillNames: ['peer-review'],
      textMessages: [answer],
      intermediateMessages: [],
    });
    expect((items[1] as { allMessages: ChatMessage[] }).allMessages).not.toContain(skillMessage);
  });

  it('preserves reasoning, tool, and answer arrival order during a streaming turn', () => {
    const thinkingBeforeTool: ChatMessage = {
      type: 'assistant',
      content: 'Inspecting the project',
      timestamp: '2026-08-19T01:00:01.000Z',
      isThinking: true,
    };
    const tool: ChatMessage = {
      type: 'assistant',
      content: '',
      timestamp: '2026-08-19T01:00:02.000Z',
      isToolUse: true,
      toolName: 'Bash',
    };
    const partialAnswer: ChatMessage = {
      type: 'assistant',
      content: 'I found the cause.',
      timestamp: '2026-08-19T01:00:03.000Z',
      isStreaming: true,
    };
    const thinkingAfterAnswer: ChatMessage = {
      type: 'assistant',
      content: 'Checking one final edge case',
      timestamp: '2026-08-19T01:00:04.000Z',
      isThinking: true,
    };

    const items = groupMessagesIntoTurns([
      { type: 'user', content: 'Fix it', timestamp: '2026-08-19T01:00:00.000Z' },
      thinkingBeforeTool,
      tool,
      partialAnswer,
      thinkingAfterAnswer,
    ], true);

    expect(items[1]).toMatchObject({
      kind: 'agent-turn',
      isActivelyStreaming: true,
      allMessages: [thinkingBeforeTool, tool, partialAnswer, thinkingAfterAnswer],
    });
  });
});
