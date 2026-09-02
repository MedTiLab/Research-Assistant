import { describe, expect, it } from 'vitest';
import { appendStreamingContent, finalizeStreamingContent } from './streamingMessages';
import type { ChatMessage } from '../types/types';

describe('streaming message identity', () => {
  it('keeps Pi text in one bubble across an interleaved notice and finalizes that bubble', () => {
    const initial = appendStreamingContent([], '建议先', false, 'pi-answer');
    const notice: ChatMessage = { type: 'assistant', content: 'Unrelated notice', timestamp: 1 };
    const messages = appendStreamingContent([...initial, notice], '确认范围。', false, 'pi-answer');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ content: '建议先确认范围。', piMessageId: 'pi-answer', isStreaming: true });
    expect(messages[1]).toBe(notice);
    expect(initial[0].content).toBe('建议先');
    const final = finalizeStreamingContent(messages, 'pi-answer');
    expect(final[0]).toMatchObject({ content: '建议先确认范围。', isStreaming: false });
    expect(final[1]).toBe(notice);
  });

  it('does not merge different Pi messages, reasoning, tools or completed text', () => {
    const messages: ChatMessage[] = [
      { type: 'assistant', content: 'Old answer', isStreaming: false, piMessageId: 'a', timestamp: 1 },
      { type: 'assistant', content: 'Tool', isToolUse: true, isStreaming: true, piMessageId: 'b', timestamp: 2 },
      { type: 'assistant', content: 'Reasoning', isThinking: true, isStreaming: true, piMessageId: 'b', timestamp: 3 },
    ];
    const appended = appendStreamingContent(messages, 'New answer', false, 'b');
    expect(appended).toHaveLength(4);
    expect(appended[2]).toMatchObject({ isThinking: true, isStreaming: false, content: 'Reasoning' });
    expect(appended[3]).toMatchObject({ content: 'New answer', piMessageId: 'b', isStreaming: true });
    const next = appendStreamingContent(appended, 'Another answer', false, 'c');
    expect(next).toHaveLength(5);
    const final = finalizeStreamingContent(next, 'b');
    expect(final[1]).toBe(next[1]);
    expect(final[3].isStreaming).toBe(false);
    expect(final[4].isStreaming).toBe(true);
  });

  it('preserves Pi reasoning classification when finalizing before any text', () => {
    const messages: ChatMessage[] = [{ type: 'assistant', content: 'Thinking', isThinking: true, isStreaming: true, piMessageId: 'a', timestamp: 1 }];
    expect(finalizeStreamingContent(messages, 'a')[0]).toMatchObject({ isThinking: true, isStreaming: false });
  });

  it('preserves last-message and newline behavior for providers without Pi IDs', () => {
    let messages = appendStreamingContent([], 'First');
    messages = appendStreamingContent(messages, 'Second', true);
    expect(messages[0].content).toBe('First\nSecond');
    expect(appendStreamingContent(messages, '')).toBe(messages);
    messages = finalizeStreamingContent(messages);
    expect(messages[0].isStreaming).toBe(false);
    expect(appendStreamingContent(messages, 'New')).toHaveLength(2);
  });
});
