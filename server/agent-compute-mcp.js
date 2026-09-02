import {
  ComputeNode,
  getActiveNode,
  loadAllNodes,
  loadNodeConfig,
} from './compute-node.js';

const STATUS_COMMAND = [
  'printf "MEDHELP_COMPUTE_OK\\n"',
  'printf "hostname=" && hostname',
  'printf "user=" && whoami',
  'printf "cpus=" && (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo unknown)',
  'printf "working_directory=" && pwd',
].join(' && ');

function safeNodeMetadata(node) {
  return {
    id: node.id,
    name: node.name || node.host,
    host: node.host,
    user: node.user,
    port: node.port || 22,
    workDir: node.workDir || '~',
    type: node.type || 'direct',
  };
}

function toolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function requireCommand(command) {
  const normalized = typeof command === 'string' ? command.trim() : '';
  if (!normalized) throw new Error('Remote command is required');
  if (normalized.length > 100_000) throw new Error('Remote command is too long');
  return normalized;
}

export function createAgentComputeToolHandlers({
  projectPath = process.env.MEDHELP_COMPUTE_PROJECT_PATH,
  computeNode = ComputeNode,
  loadActiveNode = getActiveNode,
  loadNodes = loadAllNodes,
  loadNode = loadNodeConfig,
} = {}) {
  const normalizedProjectPath = typeof projectPath === 'string' ? projectPath.trim() : '';

  const resolveTargetNode = async (requestedNodeId) => {
    const explicitNodeId = typeof requestedNodeId === 'string' ? requestedNodeId.trim() : '';
    if (explicitNodeId) {
      return { nodeId: explicitNodeId, node: await loadNode(explicitNodeId) };
    }

    const activeNode = await loadActiveNode();
    if (!activeNode?.id) {
      throw new Error('No active compute resource. Select one in MedHelp or pass nodeId explicitly.');
    }
    return { nodeId: activeNode.id, node: activeNode };
  }

  return {
    async list() {
      const config = await loadNodes();
      const nodes = Array.isArray(config?.nodes) ? config.nodes.map(safeNodeMetadata) : [];
      return toolResult({
        activeNodeId: config?.activeNodeId || null,
        nodes,
      });
    },

    async status({ nodeId } = {}, { signal } = {}) {
      const target = await resolveTargetNode(nodeId);
      const output = await computeNode.run({
        nodeId: target.nodeId,
        command: STATUS_COMMAND,
        skipSync: true,
        timeoutMs: 60_000,
        ...(signal ? { signal } : {}),
      });
      return toolResult({
        connected: true,
        node: safeNodeMetadata(target.node),
        output,
      });
    },

    async run({ nodeId, command, syncBeforeRun = false } = {}, { signal } = {}) {
      const target = await resolveTargetNode(nodeId);
      const normalizedCommand = requireCommand(command);
      if (syncBeforeRun && !normalizedProjectPath) {
        throw new Error('A local project path is required before syncing to the compute resource');
      }
      const output = await computeNode.run({
        nodeId: target.nodeId,
        command: normalizedCommand,
        cwd: normalizedProjectPath || undefined,
        skipSync: !syncBeforeRun,
        ...(signal ? { signal } : {}),
      });
      return toolResult({
        node: safeNodeMetadata(target.node),
        nodeId: target.nodeId,
        ranInRemoteProject: Boolean(normalizedProjectPath),
        syncedBeforeRun: Boolean(syncBeforeRun),
        output,
      });
    },

    async sync({ nodeId, direction = 'up', files = [] } = {}, { signal } = {}) {
      const target = await resolveTargetNode(nodeId);
      if (!normalizedProjectPath) {
        throw new Error('A local project path is required for compute synchronization');
      }
      if (direction !== 'up' && direction !== 'down') {
        throw new Error('Sync direction must be "up" or "down"');
      }
      const output = await computeNode.sync({
        nodeId: target.nodeId,
        direction,
        cwd: normalizedProjectPath,
        files,
        ...(signal ? { signal } : {}),
      });
      return toolResult({
        node: safeNodeMetadata(target.node),
        nodeId: target.nodeId,
        direction,
        files,
        output,
      });
    },
  };
}

export { STATUS_COMMAND };
