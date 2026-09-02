import { describe, expect, it } from 'vitest';
import {
  codexForkPoints,
  conversationForkPoints,
  forkedSessionTitle,
} from '../utils/sessionForking.js';

describe('conversation forking', () => {
  it('offers one fork point for each completed assistant turn', () => {
    const points = conversationForkPoints([
      { uuid: 'u1', message: { role: 'user', content: 'First question' } },
      { uuid: 'a1-tool', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'read' }] } },
      { uuid: 'u1-tool', message: { role: 'user', content: [{ type: 'tool_result', content: 'data' }] } },
      { uuid: 'a1', message: { role: 'assistant', content: 'First answer' } },
      { uuid: 'u2', message: { role: 'user', content: [{ type: 'text', text: 'Second question' }] } },
      { uuid: 'a2', message: { role: 'assistant', content: 'Second answer' } },
      { uuid: 'u3', message: { role: 'user', content: 'Incomplete question' } },
    ], {
      id: (entry) => entry.uuid,
      role: (entry) => entry.message.role,
      text: (entry) => entry.message.content,
    });

    expect(points).toEqual([
      { id: 'a1', turn: 1, preview: 'First question' },
      { id: 'a2', turn: 2, preview: 'Second question' },
    ]);
  });

  it('uses completed Codex turns and their user prompt', () => {
    expect(codexForkPoints({ turns: [
      { id: 'turn-1', status: 'completed', items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Analyze this' }] }] },
      { id: 'turn-2', status: 'inProgress', items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Still running' }] }] },
    ] })).toEqual([{ id: 'turn-1', turn: 1, preview: 'Analyze this' }]);
  });

  it('names the new item as a separate forked conversation', () => {
    expect(forkedSessionTitle({ display_name: 'Original' })).toBe('Original（分叉）');
  });
});
