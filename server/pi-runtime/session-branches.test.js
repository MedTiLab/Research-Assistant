import { describe, expect, it } from 'vitest';
import { piSessionBranches } from './session-branches.js';

const message = (id, parentId, role, text) => ({ id, parentId, type: 'message', message: { role, content: [{ type: 'text', text }] } });
const branch = (id, parentId, branchId, data = {}) => ({ id, parentId, type: 'custom', customType: 'medhelp.branch', data: { branchId, ...data } });

describe('conversation canvas projection', () => {
  it('shows alternate messages without exposing them as active fork points', () => {
    const records = [message('u1', null, 'user', 'Question'), message('a1', 'u1', 'assistant', 'Answer'),
      message('u2', 'a1', 'user', 'Original path'), branch('b1', 'a1', 'alternative', { parentBranchId: 'main', fromEntryId: 'a1' }),
      message('u3', 'b1', 'user', 'Alternate path')];
    const tree = piSessionBranches(records, 'session');
    expect(tree.messages.map((item) => item.id)).toEqual(['u1', 'a1', 'u3']);
    expect(tree.canvasMessages.find((item) => item.id === 'u2')).toMatchObject({ branchId: 'main', active: false });
    expect(tree.canvasMessages.find((item) => item.id === 'u3')).toMatchObject({ branchId: 'alternative', active: true });
    const switched = piSessionBranches([...records, branch('switch', 'u2', 'main', { action: 'switch' })], 'session');
    expect(switched.activeBranchId).toBe('main');
    expect(switched.branches).toHaveLength(2);
    expect(switched.canvasMessages.find((item) => item.id === 'u3').active).toBe(false);
    expect(switched.messages.map((item) => item.id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('does not render tool calls as forkable response cards', () => {
    const tree = piSessionBranches([{ id: 'tool', parentId: null, type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Working' }, { type: 'toolCall', id: 'call' }] } }], 'session');
    expect(tree.canvasMessages).toEqual([]);
    expect(tree.messages).toEqual([]);
  });
});
