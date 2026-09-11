import { describe, expect, it } from 'vitest';
import { layoutBranches } from './ConversationCanvas';

const branch = (id: string, parentId: string | null) => ({ id, parentId, label: id, leafId: id, fromEntryId: null });
describe('canvas branch layout', () => {
  it('lays out siblings at the same depth and descendants to the right without overlap', () => {
    const nodes = layoutBranches([branch('main', null), branch('a', 'main'), branch('b', 'main'), branch('c', 'a')]);
    expect(nodes[1].x).toBe(nodes[2].x);
    expect(nodes[3].x).toBeGreaterThan(nodes[1].x);
    expect(nodes[0].y).toBe((nodes[1].y + nodes[2].y) / 2);
    expect(nodes[1].y).toBe(nodes[3].y);
    expect(Math.abs(nodes[1].y - nodes[2].y)).toBeGreaterThan(320);
  });
  it('keeps separate subtrees apart even when descendants arrive before parents', () => {
    const nodes = layoutBranches([branch('a1', 'a'), branch('b1', 'b'), branch('main', null), branch('a', 'main'), branch('b', 'main'), branch('a2', 'a')]);
    for (const left of nodes) for (const right of nodes) {
      if (left.id !== right.id && left.x === right.x) expect(Math.abs(left.y - right.y)).toBeGreaterThanOrEqual(380);
    }
  });
  it('handles missing parents and cycles without hanging the conversation view', () => {
    const nodes = layoutBranches([branch('a', 'b'), branch('b', 'a'), branch('c', 'missing')]);
    expect(nodes).toHaveLength(3);
    expect(nodes.every((node) => Number.isFinite(node.x))).toBe(true);
  });
});
