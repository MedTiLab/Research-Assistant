import { describe, expect, it, vi } from 'vitest';
import { resolveAgentComputeBridge } from '../agent-compute-bridge.js';
import { createAgentComputeToolHandlers } from '../agent-compute-mcp.js';

const remote = { id: 'remote', host: 'gpu.example', user: 'research', type: 'direct' };
describe('conversation compute selection', () => {
  it('keeps an unselected conversation local despite a global remote selection', async () => {
    const loadActiveNode = vi.fn(async () => remote);
    const bridge = await resolveAgentComputeBridge({ nodeId: null, loadActiveNode,
      loadNodes: async () => ({ nodes: [remote], activeNodeId: remote.id }),
      resolveLauncher: () => ({ command: 'node', script: 'compute.mjs' }) });
    expect(loadActiveNode).not.toHaveBeenCalled();
    expect(bridge.node).toBeNull();
    expect(bridge.mcpServer.env.MEDHELP_COMPUTE_NODE_ID).toBe('');
  });
  it('does not fall back to a globally selected node when this conversation is local', async () => {
    const loadActiveNode = vi.fn(async () => remote);
    const tools = createAgentComputeToolHandlers({ selectedNodeId: '', loadActiveNode,
      loadNodes: async () => ({ nodes: [remote], activeNodeId: remote.id }) });
    expect((await tools.list()).structuredContent.activeNodeId).toBeNull();
    await expect(tools.status()).rejects.toThrow('No active compute resource');
    expect(loadActiveNode).not.toHaveBeenCalled();
  });
  it('routes default remote calls to the node captured for this conversation', async () => {
    const run = vi.fn(async () => 'ok');
    const tools = createAgentComputeToolHandlers({ selectedNodeId: remote.id,
      loadNode: async () => remote, computeNode: { run } });
    await tools.run({ command: 'hostname' });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ nodeId: remote.id, command: 'hostname' }));
  });
});
