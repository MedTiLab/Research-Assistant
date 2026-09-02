import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Project } from '../../../../types/app';
import type { ChatMessage } from '../../types/types';
import type { AgentTurnItem } from '../../utils/groupAgentTurns';
import AgentTurnContainer from './AgentTurnContainer';

describe('AgentTurnContainer streaming order', () => {
  it('renders each live message in provider arrival order', () => {
    const allMessages: ChatMessage[] = [
      {
        type: 'assistant',
        content: 'FIRST_REASONING_MARKER',
        timestamp: '2026-08-19T01:00:01.000Z',
        isThinking: true,
        messageId: 'thinking-1',
      },
      {
        type: 'assistant',
        content: '',
        timestamp: '2026-08-19T01:00:02.000Z',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: { command: 'SECOND_TOOL_MARKER' },
        toolId: 'tool-1',
      },
      {
        type: 'assistant',
        content: 'THIRD_ANSWER_MARKER',
        timestamp: '2026-08-19T01:00:03.000Z',
        isStreaming: true,
        messageId: 'answer-1',
      },
      {
        type: 'assistant',
        content: 'FOURTH_REASONING_MARKER',
        timestamp: '2026-08-19T01:00:04.000Z',
        isThinking: true,
        messageId: 'thinking-2',
      },
    ];
    const turn: AgentTurnItem = {
      kind: 'agent-turn',
      allMessages,
      textMessages: [allMessages[2]],
      intermediateMessages: [allMessages[0], allMessages[1], allMessages[3]],
      toolCount: 1,
      toolNames: ['Bash'],
      skillCount: 0,
      skillNames: [],
      isActivelyStreaming: true,
    };

    const markup = renderToStaticMarkup(
      <AgentTurnContainer
        turn={turn}
        getMessageKey={(message) => String(message.messageId || message.toolId)}
        createDiff={() => []}
        onGrantToolPermission={() => ({ success: true })}
        showThinking
        selectedProject={{ name: 'project-a', path: '/tmp/project-a' } as Project}
        provider="claude"
      />,
    );

    const positions = [
      'FIRST_REASONING_MARKER',
      'SECOND_TOOL_MARKER',
      'THIRD_ANSWER_MARKER',
      'FOURTH_REASONING_MARKER',
    ].map((marker) => markup.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('puts the fork action on the final answer instead of below the whole turn', () => {
    const firstAnswer: ChatMessage = {
      type: 'assistant',
      content: 'FIRST_ANSWER_MARKER',
      timestamp: '2026-08-19T01:00:01.000Z',
      messageId: 'answer-1',
    };
    const finalAnswer: ChatMessage = {
      type: 'assistant',
      content: 'FINAL_ANSWER_MARKER',
      timestamp: '2026-08-19T01:00:02.000Z',
      messageId: 'answer-2',
    };
    const turn: AgentTurnItem = {
      kind: 'agent-turn',
      allMessages: [firstAnswer, finalAnswer],
      textMessages: [firstAnswer, finalAnswer],
      intermediateMessages: [],
      toolCount: 0,
      toolNames: [],
      skillCount: 0,
      skillNames: [],
      isActivelyStreaming: false,
    };

    const markup = renderToStaticMarkup(
      <AgentTurnContainer
        turn={turn}
        getMessageKey={(message) => String(message.messageId)}
        createDiff={() => []}
        onGrantToolPermission={() => ({ success: true })}
        selectedProject={{ name: 'project-a', path: '/tmp/project-a' } as Project}
        provider="claude"
        forkControl={<button type="button">FORK_ACTION_MARKER</button>}
      />,
    );

    expect(markup.match(/FORK_ACTION_MARKER/g)).toHaveLength(1);
    expect(markup.indexOf('FORK_ACTION_MARKER')).toBeGreaterThan(markup.indexOf('FINAL_ANSWER_MARKER'));
  });
});
