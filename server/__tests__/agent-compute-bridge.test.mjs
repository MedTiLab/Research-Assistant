import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_COMPUTE_MCP_SERVER_NAME,
  buildAgentComputeMcpEnv,
  buildAgentComputeContext,
  prependAgentComputeContext,
  resolveAgentComputeBridge,
  resolveAgentComputeMcpLauncher,
} from '../agent-compute-bridge.js';
import { createAgentComputeToolHandlers } from '../agent-compute-mcp.js';

const configuredNode = {
  id: 'bigcpu-1',
  name: 'BigCPU',
  host: 'compute.example',
  user: 'researcher',
  port: 2222,
  workDir: '~/research',
  type: 'direct',
  password: 'must-not-leak',
  keyPath: '/secret/key',
};

describe('agent compute bridge', () => {
  it('describes the selected resource without exposing credentials', () => {
    const context = buildAgentComputeContext(configuredNode);

    expect(context).toContain('BigCPU');
    expect(context).toContain('researcher@compute.example:2222');
    expect(context).toContain('MedHelp compute tools');
    expect(context).toMatch(/^<medhelp_compute_context>/);
    expect(context).toMatch(/<\/medhelp_compute_context>$/);
    expect(context).not.toContain('must-not-leak');
    expect(context).not.toContain('/secret/key');
    expect(prependAgentComputeContext('check the CPUs', { prompt: context }))
      .toBe(`${context}\n\ncheck the CPUs`);
  });

  it('provides the initial active node and project path to a credential-free MCP process config', async () => {
    const bridge = await resolveAgentComputeBridge({
      projectPath: '/tmp/research project',
      loadActiveNode: vi.fn().mockResolvedValue(configuredNode),
      loadNodes: vi.fn().mockResolvedValue({
        activeNodeId: 'bigcpu-1',
        nodes: [configuredNode],
      }),
      resolveLauncher: () => ({ command: '/runtime/bin/node', script: '/runtime/agent-compute-mcp.cjs' }),
    });

    expect(bridge.node).toEqual({
      id: 'bigcpu-1',
      name: 'BigCPU',
      host: 'compute.example',
      user: 'researcher',
      port: 2222,
      workDir: '~/research',
      type: 'direct',
    });
    expect(bridge.mcpServer).toMatchObject({
      command: '/runtime/bin/node',
      args: ['/runtime/agent-compute-mcp.cjs'],
      env: {
        MEDHELP_COMPUTE_NODE_ID: 'bigcpu-1',
        MEDHELP_COMPUTE_PROJECT_PATH: path.resolve('/tmp/research project'),
      },
    });
    expect(JSON.stringify(bridge)).not.toContain('must-not-leak');
    expect(AGENT_COMPUTE_MCP_SERVER_NAME).toBe('medhelp_compute');
  });

  it('keeps the compute bridge available when local is selected but remote nodes are configured', async () => {
    const bridge = await resolveAgentComputeBridge({
      projectPath: '/tmp/research project',
      loadActiveNode: vi.fn().mockResolvedValue(null),
      loadNodes: vi.fn().mockResolvedValue({
        activeNodeId: null,
        selectionMode: 'local',
        nodes: [configuredNode],
      }),
      resolveLauncher: () => ({ command: '/runtime/bin/node', script: '/runtime/agent-compute-mcp.cjs' }),
    });

    expect(bridge.node).toBeNull();
    expect(bridge.nodes).toMatchObject([{ id: 'bigcpu-1', name: 'BigCPU' }]);
    expect(bridge.mcpServer?.env).toMatchObject({
      MEDHELP_COMPUTE_NODE_ID: '',
      MEDHELP_COMPUTE_PROJECT_PATH: path.resolve('/tmp/research project'),
    });
    expect(bridge.prompt).toContain('No remote compute resource is currently selected in the UI.');
    expect(bridge.prompt).toContain('Configured remote resources remain available');
    expect(JSON.stringify(bridge)).not.toContain('must-not-leak');
  });

  it('inherits only safe Windows process variables for SSH and home resolution', () => {
    expect(buildAgentComputeMcpEnv({
      platform: 'win32',
      env: {
        PATH: 'C:\\Windows\\System32',
        USERPROFILE: 'C:\\Users\\researcher',
        APPDATA: 'C:\\Users\\researcher\\AppData\\Roaming',
        OPENAI_API_KEY: 'must-not-leak',
      },
      nodeId: 'bigcpu-1',
      projectPath: 'C:\\research',
    })).toEqual({
      APPDATA: 'C:\\Users\\researcher\\AppData\\Roaming',
      PATH: 'C:\\Windows\\System32',
      USERPROFILE: 'C:\\Users\\researcher',
      MEDHELP_COMPUTE_NODE_ID: 'bigcpu-1',
      MEDHELP_COMPUTE_PROJECT_PATH: path.win32.resolve('C:\\research'),
    });
  });

  it('resolves the bundled Kernel MCP launcher without relying on source files', () => {
    const launcher = resolveAgentComputeMcpLauncher({
      env: {
        MEDHELP_RUNTIME_ROOT: '/installed/runtime',
      },
      existsSync: () => true,
    });

    expect(launcher).toEqual({
      command: '/installed/runtime/bin/node',
      script: '/installed/runtime/agent-compute-mcp.cjs',
    });
  });
});

describe('agent compute MCP handlers', () => {
  it('uses the current active node for status, remote project execution, and synchronization', async () => {
    const computeNode = {
      run: vi.fn()
        .mockResolvedValueOnce('MEDHELP_COMPUTE_OK')
        .mockResolvedValueOnce('analysis complete'),
      sync: vi.fn().mockResolvedValue('synced'),
    };
    const handlers = createAgentComputeToolHandlers({
      projectPath: '/tmp/project',
      computeNode,
      loadActiveNode: vi.fn().mockResolvedValue(configuredNode),
      loadNodes: vi.fn().mockResolvedValue({
        activeNodeId: 'bigcpu-1',
        nodes: [configuredNode],
      }),
      loadNode: vi.fn().mockResolvedValue(configuredNode),
    });

    const list = await handlers.list();
    const status = await handlers.status();
    const run = await handlers.run({ command: 'python analysis.py', syncBeforeRun: false });
    const sync = await handlers.sync({ direction: 'down', files: ['results/'] });

    expect(list.structuredContent).toMatchObject({
      activeNodeId: 'bigcpu-1',
      nodes: [{ id: 'bigcpu-1', name: 'BigCPU' }],
    });
    expect(list.content[0].text).not.toContain('must-not-leak');
    expect(status.structuredContent).toMatchObject({
      connected: true,
      node: { id: 'bigcpu-1', name: 'BigCPU' },
    });
    expect(status.content[0].text).not.toContain('must-not-leak');
    expect(computeNode.run).toHaveBeenNthCalledWith(2, {
      nodeId: 'bigcpu-1',
      command: 'python analysis.py',
      cwd: '/tmp/project',
      skipSync: true,
    });
    expect(run.structuredContent).toMatchObject({
      ranInRemoteProject: true,
      syncedBeforeRun: false,
      output: 'analysis complete',
    });
    expect(computeNode.sync).toHaveBeenCalledWith({
      nodeId: 'bigcpu-1',
      direction: 'down',
      cwd: '/tmp/project',
      files: ['results/'],
    });
    expect(sync.structuredContent.output).toBe('synced');
  });

  it('hot-switches the default node and can route explicitly to multiple nodes', async () => {
    const gpuNode = {
      ...configuredNode,
      id: 'gpu-1',
      name: 'GPU',
      host: 'gpu.example',
    };
    let activeNode = configuredNode;
    const nodes = new Map([
      [configuredNode.id, configuredNode],
      [gpuNode.id, gpuNode],
    ]);
    const computeNode = {
      run: vi.fn().mockResolvedValue('MEDHELP_COMPUTE_OK'),
      sync: vi.fn().mockResolvedValue('synced'),
    };
    const handlers = createAgentComputeToolHandlers({
      projectPath: '/tmp/project',
      computeNode,
      loadActiveNode: vi.fn(async () => activeNode),
      loadNodes: vi.fn(async () => ({ activeNodeId: activeNode.id, nodes: [...nodes.values()] })),
      loadNode: vi.fn(async (nodeId) => nodes.get(nodeId)),
    });

    expect((await handlers.status()).structuredContent.node.id).toBe('bigcpu-1');
    activeNode = gpuNode;
    expect((await handlers.status()).structuredContent.node.id).toBe('gpu-1');

    await handlers.run({ nodeId: 'bigcpu-1', command: 'python cpu_job.py' });
    await handlers.run({ nodeId: 'gpu-1', command: 'python gpu_job.py' });

    expect(computeNode.run).toHaveBeenNthCalledWith(3, {
      nodeId: 'bigcpu-1',
      command: 'python cpu_job.py',
      cwd: '/tmp/project',
      skipSync: true,
    });
    expect(computeNode.run).toHaveBeenNthCalledWith(4, {
      nodeId: 'gpu-1',
      command: 'python gpu_job.py',
      cwd: '/tmp/project',
      skipSync: true,
    });
  });
});
