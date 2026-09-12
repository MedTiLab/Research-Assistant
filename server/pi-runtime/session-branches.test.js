import { describe, expect, it } from 'vitest';
import { piSessionBranches, deletePiSessionBranch } from './session-branches.js';

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


describe('branch deletion', () => {
  function session() {
    const records = [message('u1', null, 'user', 'Shared question'), message('a1', 'u1', 'assistant', 'Shared answer'),
      branch('b1', 'a1', 'a', { parentBranchId: 'main' }), message('u2', 'b1', 'user', 'Branch A'),
      branch('b2', 'u2', 'child', { parentBranchId: 'a' }), message('u3', 'b2', 'user', 'Child'),
      branch('b3', 'a1', 'sibling', { parentBranchId: 'main' }), message('u4', 'b3', 'user', 'Sibling')];
    let leaf = records.at(-1).id;
    return {
      getEntries: () => records,
      branch: (id) => { leaf = id; },
      appendCustomEntry: (customType, data) => {
        const id = `marker-${records.length}`;
        records.push({ id, parentId: leaf, type: 'custom', customType, data });
        leaf = id;
      },
    };
  }

  it('deletes a subtree while preserving the active sibling and shared history across reloads', () => {
    const manager = session();
    const result = deletePiSessionBranch(manager, 'session', 'a');
    expect(result.branches.map((item) => item.id)).toEqual(['main', 'sibling']);
    expect(result.activeBranchId).toBe('sibling');
    expect(result.canvasMessages.map((item) => item.id)).toEqual(['u1', 'a1', 'u4']);
    expect(result.messages.map((item) => item.id)).toEqual(['u1', 'a1', 'u4']);
    expect(piSessionBranches(manager.getEntries(), 'session')).toEqual(result);
    expect(manager.getEntries().some((item) => item.id === 'u3')).toBe(true);
    manager.branch('a1');
    manager.appendCustomEntry('medhelp.branch', { action: 'switch', branchId: 'main' });
    expect(piSessionBranches(manager.getEntries(), 'session').branches.map((item) => item.id)).toEqual(['main', 'sibling']);
  });

  it('returns to the surviving parent when deleting the active descendant subtree', () => {
    const manager = session();
    manager.branch('u3');
    manager.appendCustomEntry('medhelp.branch', { action: 'switch', branchId: 'child' });
    const result = deletePiSessionBranch(manager, 'session', 'a');
    expect(result.activeBranchId).toBe('main');
    expect(result.messages.map((item) => item.id)).toEqual(['u1', 'a1']);
    expect(result.branches.map((item) => item.id)).toEqual(['main', 'sibling']);
  });

  it('supports empty branches and rejects main, unknown, and already deleted branches without writing', () => {
    const manager = session();
    manager.branch('a1');
    manager.appendCustomEntry('medhelp.branch', { action: 'create', branchId: 'empty', parentBranchId: 'main' });
    expect(deletePiSessionBranch(manager, 'session', 'empty').activeBranchId).toBe('main');
    const count = manager.getEntries().length;
    for (const id of ['main', 'missing', 'empty']) expect(() => deletePiSessionBranch(manager, 'session', id)).toThrow();
    expect(manager.getEntries()).toHaveLength(count);
  });
});
