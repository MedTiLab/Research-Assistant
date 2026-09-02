import { describe, expect, it } from 'vitest';

import { ResponseCollector } from '../routes/agent.js';

describe('external agent response collector', () => {
  it('collects Claude assistant messages from objects and JSON strings', () => {
    const collector = new ResponseCollector();
    const objectMessage = {
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: { role: 'assistant', content: 'Claude object reply' },
      },
    };
    const stringMessage = JSON.stringify({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: { role: 'assistant', content: 'Claude string reply' },
      },
    });

    collector.send({ type: 'status', message: 'Session started' });
    collector.send(objectMessage);
    collector.send(stringMessage);

    expect(collector.getAssistantMessages()).toEqual([
      objectMessage.data,
      JSON.parse(stringMessage).data,
    ]);
    expect(collector.getNormalizedAssistantMessages()).toEqual([
      { role: 'assistant', content: 'Claude object reply' },
      { role: 'assistant', content: 'Claude string reply' },
    ]);
  });

  it('collects Codex assistant agent messages and ignores non-assistant items', () => {
    const collector = new ResponseCollector();
    const assistantMessage = { role: 'assistant', content: 'Codex reply' };

    collector.send({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        message: assistantMessage,
      },
    });
    collector.send(JSON.stringify({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'reasoning',
        message: { role: 'assistant', content: 'Do not expose this' },
      },
    }));
    collector.send({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        message: { role: 'user', content: 'Not an assistant reply' },
      },
    });

    expect(collector.getAssistantMessages()).toEqual([assistantMessage]);
    expect(collector.getNormalizedAssistantMessages()).toEqual([assistantMessage]);
  });

  it('keeps only completed Codex assistant observations when lifecycle metadata is present', () => {
    const collector = new ResponseCollector({ provider: 'codex' });

    collector.send({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        lifecycle: 'updated',
        message: { role: 'assistant', content: 'Partial' },
      },
    });
    collector.send({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        lifecycle: 'completed',
        message: { role: 'assistant', content: 'Final' },
      },
    });

    expect(collector.getAssistantMessages()).toEqual([
      { role: 'assistant', content: 'Partial' },
      { role: 'assistant', content: 'Final' },
    ]);
    expect(collector.getNormalizedAssistantMessages()).toEqual([
      { role: 'assistant', content: 'Final' },
    ]);
  });

  it('does not mix Codex token-budget events into Claude token accounting', () => {
    const collector = new ResponseCollector({ provider: 'claude' });

    collector.send({
      type: 'token-budget',
      data: {
        usage: {
          input_tokens: 10,
          cached_input_tokens: 5,
          output_tokens: 3,
          reasoning_output_tokens: 2,
        },
      },
    });

    expect(collector.getTotalTokens()).toEqual({
      provider: 'claude',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: null,
      context: null,
      totalTokens: 0,
      rawSemantics: 'claude',
    });
  });

  it('collects Claude usage through runtime observations', () => {
    const collector = new ResponseCollector({ provider: 'claude' });

    collector.send({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'Done',
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 2,
          },
        },
      },
    });

    expect(collector.getTotalTokens()).toEqual({
      provider: 'claude',
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      reasoningTokens: null,
      context: null,
      totalTokens: 19,
      rawSemantics: 'claude',
    });
  });

  it('collects Codex token budgets without double-counting cache or reasoning', () => {
    const collector = new ResponseCollector({ provider: 'codex' });

    collector.send({
      type: 'token-budget',
      data: {
        used: 14,
        total: 258_400,
        breakdown: {
          input: 10,
          cacheRead: 3,
          cacheCreation: 0,
          output: 4,
          reasoning: 2,
        },
      },
    });

    expect(collector.getTotalTokens()).toEqual({
      provider: 'codex',
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheCreationTokens: 0,
      reasoningTokens: 2,
      context: { used: 14, total: 258_400, estimated: false },
      totalTokens: 14,
      rawSemantics: 'codex',
    });
  });
});
