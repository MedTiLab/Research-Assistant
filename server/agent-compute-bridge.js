import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getActiveNode, loadAllNodes, loadNodeConfig } from './compute-node.js';

export const AGENT_COMPUTE_MCP_SERVER_NAME = 'medhelp_compute';

const MCP_ENV_KEYS = Object.freeze({
  win32: [
    'APPDATA',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'PATH',
    'PROCESSOR_ARCHITECTURE',
    'PROGRAMFILES',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'USERNAME',
    'USERPROFILE',
  ],
  default: ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER'],
});

function sanitizeComputeNode(node) {
  if (!node) return null;
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

export function resolveAgentComputeMcpLauncher({
  env = process.env,
  platform = process.platform,
  nodeExecutable = process.execPath,
  moduleUrl = import.meta.url,
  existsSync = fs.existsSync,
} = {}) {
  const runtimeRoot = typeof env.MEDHELP_RUNTIME_ROOT === 'string'
    ? env.MEDHELP_RUNTIME_ROOT.trim()
    : '';
  if (runtimeRoot) {
    const command = path.join(runtimeRoot, 'bin', platform === 'win32' ? 'node.exe' : 'node');
    const script = path.join(runtimeRoot, 'agent-compute-mcp.cjs');
    return existsSync(command) && existsSync(script) ? { command, script } : null;
  }

  const script = fileURLToPath(new URL('./bin/agent-compute-mcp.js', moduleUrl));
  return existsSync(nodeExecutable) && existsSync(script)
    ? { command: nodeExecutable, script }
    : null;
}

export function buildAgentComputeContext(node, { bridgeAvailable = true, nodes = [] } = {}) {
  const safeNode = sanitizeComputeNode(node);
  const safeNodes = Array.isArray(nodes)
    ? nodes.map(sanitizeComputeNode).filter(Boolean)
    : [];
  if (!safeNode && safeNodes.length === 0) return '';

  const lines = [
    '<medhelp_compute_context>',
    '[MedHelp Kernel compute resource]',
  ];

  if (safeNode) {
    lines.push(
      `The user selected the remote compute resource "${safeNode.name}" for this turn.`,
      `Node: ${safeNode.user}@${safeNode.host}:${safeNode.port}`,
      `Remote work directory: ${safeNode.workDir}`,
      `Resource type: ${safeNode.type}`,
    );
  } else {
    lines.push(
      'No remote compute resource is currently selected in the UI.',
      'Configured remote resources remain available through the MedHelp compute tools.',
    );
  }

  if (bridgeAvailable) {
    lines.push(
      'Use the MedHelp compute tools (list, status, run, and sync) for remote work.',
      'The selected UI resource is the dynamic default when nodeId is omitted. Use list to discover all configured resources and pass nodeId explicitly when routing work across multiple servers in the same conversation.',
      'Inspect candidate nodes with status before scheduling: route CPU-heavy work to CPU resources and GPU-dependent work to GPU resources.',
      'Do not ask for SSH credentials and do not call ssh, scp, or rsync directly: the local Kernel already owns the saved credentials.',
      'Local shell and file tools still operate on the local project. Use sync, or run with syncBeforeRun, only when local project files changed and the remote command needs those changes. Do not synchronize again before every remote command when local files are unchanged.',
      'Synchronization is incremental, so unchanged large files are skipped automatically.',
    );
  } else {
    lines.push(
      'The Kernel compute bridge is unavailable in this installation. Explain that the local Kernel must be updated; do not ask the user for SSH credentials.',
    );
  }

  lines.push('</medhelp_compute_context>');

  return lines.join('\n');
}

export function prependAgentComputeContext(command, bridge) {
  const prompt = typeof bridge?.prompt === 'string' ? bridge.prompt.trim() : '';
  return prompt ? `${prompt}\n\n${command}` : command;
}

export function buildAgentComputeMcpEnv({
  env = process.env,
  platform = process.platform,
  nodeId,
  projectPath = '',
} = {}) {
  const serverEnv = {};
  const inheritedKeys = platform === 'win32' ? MCP_ENV_KEYS.win32 : MCP_ENV_KEYS.default;
  for (const key of inheritedKeys) {
    const value = typeof env[key] === 'string' ? env[key] : '';
    if (value && !value.startsWith('()')) serverEnv[key] = value;
  }
  serverEnv.MEDHELP_COMPUTE_NODE_ID = nodeId;
  const pathImpl = platform === 'win32' ? path.win32 : path;
  serverEnv.MEDHELP_COMPUTE_PROJECT_PATH = projectPath ? pathImpl.resolve(projectPath) : '';
  return serverEnv;
}

export async function resolveAgentComputeBridge({
  projectPath = '',
  nodeId = null,
  env = process.env,
  loadActiveNode = getActiveNode,
  loadNodes = loadAllNodes,
  loadNode = loadNodeConfig,
  resolveLauncher = resolveAgentComputeMcpLauncher,
} = {}) {
  const config = await loadNodes();
  const configuredNodes = Array.isArray(config?.nodes) ? config.nodes : [];
  const node = nodeId ? await loadNode(nodeId) : await loadActiveNode();
  const safeNode = sanitizeComputeNode(node);
  const safeNodes = configuredNodes.map(sanitizeComputeNode).filter(Boolean);
  if (!safeNode && safeNodes.length === 0) return null;

  const launcher = resolveLauncher({ env });
  const prompt = buildAgentComputeContext(safeNode, {
    bridgeAvailable: Boolean(launcher),
    nodes: safeNodes,
  });
  if (!launcher) {
    return { node: safeNode, nodes: safeNodes, prompt, mcpServer: null };
  }

  const serverEnv = buildAgentComputeMcpEnv({
    env,
    nodeId: safeNode?.id || '',
    projectPath,
  });

  return {
    node: safeNode,
    nodes: safeNodes,
    prompt,
    mcpServer: {
      command: launcher.command,
      args: [launcher.script],
      env: serverEnv,
    },
  };
}
