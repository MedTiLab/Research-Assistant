import { promises as fs } from 'fs';
import path from 'path';
import { createPiRuntimeError } from './rpc-client.js';
import { SERVICE_TOOL_BY_NAME, PLAN_TOOL_NAMES, authorizeServiceTool } from '../agent-runtime/service-tools.js';

export const PI_READ_ONLY_TOOLS = Object.freeze(['read', 'grep', 'find', 'ls', 'system_info']);
export const PI_WRITE_TOOLS = Object.freeze(['write', 'edit', 'bash']);
export const PI_COORDINATION_TOOLS = Object.freeze([
  'ask_user',
  'todo_read',
  'todo_write',
  'task_create',
  'task_update',
  'task_list',
  'task_get',
  'task',
]);
export const PI_PERMISSION_MODES = Object.freeze(['auto', 'readOnly', 'ask', 'plan']);
export const PI_BASH_DEFAULT_TIMEOUT_MS = 60_000;
export const PI_BASH_MAX_TIMEOUT_MS = 120_000;
export const PI_MCP_TOOL_PREFIX = 'mcp__';

const PI_READ_ONLY_TOOL_SET = new Set(PI_READ_ONLY_TOOLS);
const PI_WRITE_TOOL_SET = new Set(PI_WRITE_TOOLS);
const PI_COORDINATION_TOOL_SET = new Set(PI_COORDINATION_TOOLS);
const PI_PERMISSION_MODE_SET = new Set(PI_PERMISSION_MODES);
const PATH_FIELDS = Object.freeze(['path', 'file', 'filePath', 'directory']);
const DANGEROUS_BASH_PATTERNS = Object.freeze([
  { pattern: /(?:^|[;&|]\s*)(?:sudo|doas)\b/i, reason: 'privilege escalation is disabled' },
  { pattern: /\brm\s+(?=[^\n]*-[^\n]*[rf])[^\n]*(?:\s|^)(?:\/|~|\$HOME)(?:\/|\s|$)/i, reason: 'broad recursive deletion is disabled' },
  { pattern: /\brm\b[^\n]*--no-preserve-root\b/i, reason: 'broad recursive deletion is disabled' },
  { pattern: /\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk|parted|shutdown|reboot|halt|poweroff)\b/i, reason: 'system or disk administration is disabled' },
  { pattern: /\bdiskutil\s+(?:erase|partition|zeroDisk|secureErase)\b/i, reason: 'disk administration is disabled' },
  { pattern: /\bdd\b[^\n]*\bof\s*=\s*\/dev\//i, reason: 'raw device writes are disabled' },
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*;\s*\}\s*;\s*:/, reason: 'fork bombs are disabled' },
  { pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z|k)?sh\b/i, reason: 'piping downloaded code to a shell is disabled' },
]);

function isWithinRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function realpathNearestExisting(candidate) {
  let current = candidate;
  while (true) {
    try {
      const existing = await fs.realpath(current);
      return {
        existing,
        suffix: path.relative(current, candidate),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function assertSafePattern(value, label) {
  if (typeof value !== 'string' || !value.trim()) return;
  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(value) || normalized.split('/').includes('..')) {
    throw createPiRuntimeError(
      'PI_TOOL_PATH_OUTSIDE_PROJECT',
      `${label} must remain inside the project root.`,
    );
  }
}

export function normalizePiMcpToolPart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63) || 'tool';
}

export function normalizePiPermissionMode(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return PI_PERMISSION_MODE_SET.has(normalized) ? normalized : 'readOnly';
}

export async function resolvePiToolPath(projectRoot, requestedPath = '.', options = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw createPiRuntimeError('PI_TOOL_PATH_INVALID', 'A canonical project root is required.');
  }
  const canonicalRoot = await fs.realpath(path.resolve(projectRoot));
  const rawPath = typeof requestedPath === 'string' && requestedPath.trim()
    ? requestedPath.trim()
    : '.';
  if (rawPath.includes('\0')) {
    throw createPiRuntimeError('PI_TOOL_PATH_INVALID', 'Pi tool paths cannot contain NUL bytes.');
  }
  const additionalRoots = [];
  for (const root of Array.isArray(options.additionalRoots) ? options.additionalRoots : []) {
    try {
      additionalRoots.push(await fs.realpath(path.resolve(root)));
    } catch {}
  }
  const allowedRoots = [canonicalRoot, ...additionalRoots];
  const resolved = path.resolve(canonicalRoot, rawPath);
  if (!allowedRoots.some((root) => isWithinRoot(root, resolved))) {
    throw createPiRuntimeError(
      'PI_TOOL_PATH_OUTSIDE_PROJECT',
      'Pi tool path must remain inside the project root.',
    );
  }
  const nearest = await realpathNearestExisting(resolved);
  const canonicalCandidate = path.resolve(nearest.existing, nearest.suffix);
  if (!allowedRoots.some((root) => isWithinRoot(root, canonicalCandidate))) {
    throw createPiRuntimeError(
      'PI_TOOL_PATH_OUTSIDE_PROJECT',
      'Pi tool path resolves outside the project root.',
    );
  }
  return canonicalCandidate;
}

export const resolvePiReadOnlyPath = resolvePiToolPath;

export function authorizePiBashInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createPiRuntimeError('PI_TOOL_INPUT_INVALID', 'Pi bash input must be an object.');
  }
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (!command || command.length > 16_000 || command.includes('\0')) {
    throw createPiRuntimeError(
      'PI_TOOL_INPUT_INVALID',
      'Pi bash requires a non-empty command no longer than 16,000 characters.',
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, 'cwd')) {
    throw createPiRuntimeError(
      'PI_TOOL_CWD_FIXED',
      'Pi bash always runs from the canonical project root.',
    );
  }
  const dangerous = DANGEROUS_BASH_PATTERNS.find(({ pattern }) => pattern.test(command));
  if (dangerous) {
    throw createPiRuntimeError(
      'PI_TOOL_COMMAND_BLOCKED',
      `Pi bash command was blocked because ${dangerous.reason}.`,
    );
  }
  const requestedTimeout = Number(input.timeout);
  const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(Math.floor(requestedTimeout), PI_BASH_MAX_TIMEOUT_MS)
    : PI_BASH_DEFAULT_TIMEOUT_MS;
  return Object.freeze({ command, timeout });
}

export async function authorizePiToolCall(toolName, input = {}, context = {}) {
  const normalizedToolName = typeof toolName === 'string' ? toolName.trim().toLowerCase() : '';
  const permissionMode = normalizePiPermissionMode(context.permissionMode);
  if (SERVICE_TOOL_BY_NAME.has(normalizedToolName)) return authorizeServiceTool(normalizedToolName, input, permissionMode);
  if (PLAN_TOOL_NAMES.includes(normalizedToolName) || ['tool_search', 'tool_describe', 'tool_call'].includes(normalizedToolName)) {
    return { allowed: true, requiresApproval: normalizedToolName === 'exit_plan_mode', toolName: normalizedToolName, input, permissionMode };
  }
  const isReadOnly = PI_READ_ONLY_TOOL_SET.has(normalizedToolName);
  const isWrite = PI_WRITE_TOOL_SET.has(normalizedToolName);
  const isCoordination = PI_COORDINATION_TOOL_SET.has(normalizedToolName);
  const isMcp = /^mcp__[a-z0-9][a-z0-9_-]{0,62}__[a-z0-9][a-z0-9_-]{0,62}$/.test(normalizedToolName);
  if (!isReadOnly && !isWrite && !isCoordination && !isMcp) {
    throw createPiRuntimeError(
      'PI_TOOL_NOT_ALLOWED',
      `Pi tool "${normalizedToolName || 'unknown'}" is not enabled.`,
      { toolName: normalizedToolName || null },
    );
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createPiRuntimeError('PI_TOOL_INPUT_INVALID', 'Pi tool input must be an object.');
  }
  if (isMcp && permissionMode !== 'ask' && permissionMode !== 'auto') {
    throw createPiRuntimeError(
      permissionMode === 'plan' ? 'PI_TOOL_WRITE_BLOCKED_IN_PLAN' : 'PI_TOOL_NOT_ALLOWED',
      `Pi MCP tool "${normalizedToolName}" requires Ask mode and explicit approval.`,
      { toolName: normalizedToolName },
    );
  }
  if (isMcp) {
    const serverName = normalizedToolName.split('__')[1];
    const trustedServers = new Set(
      (Array.isArray(context.trustedMcpServers) ? context.trustedMcpServers : [])
        .map(normalizePiMcpToolPart),
    );
    if (!trustedServers.has(serverName)) {
      throw createPiRuntimeError(
        'PI_TOOL_NOT_ALLOWED',
        `Pi MCP server "${serverName}" is not part of this turn's trusted projection.`,
        { toolName: normalizedToolName },
      );
    }
  }
  if (isWrite && permissionMode === 'plan') {
    throw createPiRuntimeError(
      'PI_TOOL_WRITE_BLOCKED_IN_PLAN',
      `Pi ${normalizedToolName} is disabled in Plan mode.`,
      { toolName: normalizedToolName },
    );
  }
  if (isWrite && permissionMode !== 'ask' && permissionMode !== 'auto') {
    throw createPiRuntimeError(
      'PI_TOOL_NOT_ALLOWED',
      `Pi ${normalizedToolName} requires Ask mode and explicit approval.`,
      { toolName: normalizedToolName },
    );
  }

  const canonicalProjectRoot = await fs.realpath(path.resolve(context.projectRoot));
  if (isCoordination) {
    return Object.freeze({
      allowed: true,
      requiresApproval: false,
      permissionMode,
      toolName: normalizedToolName,
      input: Object.freeze({ ...input }),
      projectRoot: canonicalProjectRoot,
    });
  }
  if (isMcp) {
    return Object.freeze({
      allowed: true,
      requiresApproval: permissionMode === 'ask',
      permissionMode,
      toolName: normalizedToolName,
      input: Object.freeze({ ...input }),
      projectRoot: canonicalProjectRoot,
    });
  }
  let normalizedInput = { ...input };
  if (normalizedToolName === 'bash') {
    normalizedInput = { ...authorizePiBashInput(input) };
  } else if (normalizedToolName === 'system_info') {
    normalizedInput = {};
  } else {
    const pathEntries = PATH_FIELDS
      .filter((field) => typeof input[field] === 'string')
      .map((field) => [field, input[field]]);
    if (pathEntries.length === 0) pathEntries.push(['path', '.']);
    const resolvedPaths = {};
    for (const [field, value] of pathEntries) {
      resolvedPaths[field] = await resolvePiToolPath(canonicalProjectRoot, value, {
        additionalRoots: isReadOnly ? context.trustedReadRoots : [],
      });
    }
    normalizedInput = { ...input, ...resolvedPaths };
    if (normalizedToolName === 'find') assertSafePattern(input.pattern, 'Pi find pattern');
    if (normalizedToolName === 'grep') assertSafePattern(input.glob, 'Pi grep glob');
  }

  return Object.freeze({
    allowed: true,
    requiresApproval: isWrite && permissionMode === 'ask',
    permissionMode,
    toolName: normalizedToolName,
    input: Object.freeze(normalizedInput),
    projectRoot: canonicalProjectRoot,
  });
}

export function createPiToolPolicy(projectRoot, options = {}) {
  const permissionMode = normalizePiPermissionMode(options.permissionMode);
  const allowedTools = permissionMode === 'ask' || permissionMode === 'auto'
    ? Object.freeze([...PI_READ_ONLY_TOOLS, ...PI_WRITE_TOOLS, ...PI_COORDINATION_TOOLS])
    : Object.freeze([...PI_READ_ONLY_TOOLS, ...PI_COORDINATION_TOOLS]);
  return Object.freeze({
    mode: permissionMode,
    allowedTools,
    authorize: (toolName, input) => authorizePiToolCall(toolName, input, {
      projectRoot,
      permissionMode,
      trustedReadRoots: options.trustedReadRoots,
      trustedMcpServers: options.trustedMcpServers,
    }),
  });
}
