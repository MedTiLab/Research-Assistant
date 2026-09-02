import crypto from 'crypto';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveAppDataRoot } from '../utils/storagePaths.js';
import {
  DEFAULT_PI_HOST_LIMITS,
  PI_HOST_PROTOCOL_VERSION,
  PiRpcClient,
  createPiRuntimeError,
} from './rpc-client.js';
import { PI_SDK_VERSION } from './provider-config.js';
import {
  PI_COORDINATION_TOOLS,
  PI_READ_ONLY_TOOLS,
  PI_WRITE_TOOLS,
  normalizePiPermissionMode,
} from './tool-policy.js';
import { createTrustedPiSkillProjection } from './skill-projection.js';
import {
  diagnosePiHostLaunch,
  isSupportedPiNodeVersion,
  PI_HOST_BUILD_ID,
  PI_MINIMUM_NODE_VERSION,
} from './runtime-diagnostics.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FAUX_HOST_PATH = path.join(MODULE_DIR, 'faux-host.mjs');
const SAFE_INHERITED_ENV_KEYS = Object.freeze([
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'NODE_EXTRA_CA_CERTS',
  'MEDHELP_PI_OUTPUT_MAX_BYTES',
  'MEDHELP_PI_OUTPUT_SESSION_BYTES',
  'MEDHELP_PI_OUTPUT_TIGHT_BYTES',
  'MEDHELP_PI_OUTPUT_RETENTION_DAYS',
  'MEDHELP_PI_OUTPUT_CACHE_SESSION_BYTES',
  'MEDHELP_PI_OUTPUT_CACHE_PROJECT_BYTES',
  'MEDHELP_PI_OUTPUT_CACHE_MAX_FILES',
  'MEDHELP_PI_IMAGE_CONTEXT_BYTES',
  'MEDHELP_PI_IMAGE_CONTEXT_COUNT',
]);

function hashIdentity(value) {
  return crypto.createHash('sha256').update(String(value || 'anonymous')).digest('hex').slice(0, 20);
}

function safeTurnId(value) {
  return String(value || crypto.randomUUID())
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || crypto.randomUUID();
}

function pickSafeEnvironment(source = process.env) {
  return Object.fromEntries(SAFE_INHERITED_ENV_KEYS
    .filter((key) => typeof source[key] === 'string')
    .map((key) => [key, source[key]]));
}

function createTimeout(promise, timeoutMs, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function terminateHostTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return;
    } catch {}
  }
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  try {
    child.kill(signal);
  } catch {}
}

function normalizeSecretEnvironment(secretEnv) {
  if (!secretEnv || typeof secretEnv !== 'object' || Array.isArray(secretEnv)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(secretEnv)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== 'string') {
      throw createPiRuntimeError(
        'PI_HOST_PROTOCOL_ERROR',
        'Pi Host secret environment contains an invalid entry.',
      );
    }
    normalized[key] = value;
  }
  return normalized;
}

export function resolvePreparedPiHostPath(options = {}) {
  return path.join(
    resolveAppDataRoot(options),
    'pi',
    'runtime',
    PI_SDK_VERSION,
    `${process.platform}-${process.arch}`,
    'sdk-host.mjs',
  );
}

export function resolvePiHostLaunch(options = {}) {
  const env = options.env || process.env;
  const explicitCommand = typeof options.command === 'string' && options.command.trim()
    ? options.command.trim()
    : null;
  if (explicitCommand) {
    return {
      command: explicitCommand,
      args: Array.isArray(options.args) ? [...options.args] : [],
      hostPath: null,
      source: 'command',
    };
  }

  const bundledRuntimeRoot = env.MEDHELP_RUNTIME_ROOT;
  const bundledHostPath = bundledRuntimeRoot ? path.join(bundledRuntimeRoot, 'pi-runtime', 'sdk-host.mjs') : null;
  const configuredHostPath = options.hostPath || env.MEDHELP_PI_HOST_PATH || bundledHostPath || resolvePreparedPiHostPath(options);
  const source = options.hostPath ? 'explicit' : (env.MEDHELP_PI_HOST_PATH ? 'configured' : (bundledHostPath ? 'bundled' : 'prepared'));
  const hostPath = path.resolve(configuredHostPath);
  if (/\.(?:c?js|mjs)$/i.test(hostPath)) {
    return {
      command: env.MEDHELP_PI_NODE_PATH || (bundledRuntimeRoot
        ? path.join(bundledRuntimeRoot, 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
        : process.execPath),
      args: [hostPath],
      hostPath,
      source,
    };
  }
  return { command: hostPath, args: [], hostPath, source };
}

export class PiHostManager {
  constructor(options = {}) {
    this.options = Object.freeze({
      protocolVersion: options.protocolVersion ?? PI_HOST_PROTOCOL_VERSION,
      startTimeoutMs: options.startTimeoutMs ?? 5_000,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_PI_HOST_LIMITS.requestTimeoutMs,
      abortTimeoutMs: options.abortTimeoutMs ?? 1_000,
      terminateTimeoutMs: options.terminateTimeoutMs ?? 1_000,
      maxLineBytes: options.maxLineBytes ?? DEFAULT_PI_HOST_LIMITS.maxLineBytes,
      maxStderrBytes: options.maxStderrBytes ?? DEFAULT_PI_HOST_LIMITS.maxStderrBytes,
      configRoot: path.resolve(
        options.configRoot || path.join(resolveAppDataRoot(options), 'pi', 'config'),
      ),
      launch: resolvePiHostLaunch(options),
      env: options.env || process.env,
      hostEnv: options.hostEnv && typeof options.hostEnv === 'object'
        ? { ...options.hostEnv }
        : {},
    });
    this.spawnProcess = options.spawnProcess || spawn;
    this.records = new Map();
  }

  async createTurnConfig(context) {
    const ownerHash = hashIdentity(context.identity?.ownerKey);
    const configDir = path.join(this.options.configRoot, ownerHash, safeTurnId(context.turnId));
    try {
      await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
      const modelConfig = context.providerConfig?.modelConfig || {
        provider: 'faux',
        modelId: context.modelId || 'pi-faux-v1',
        api: 'faux',
        protocolVersion: this.options.protocolVersion,
      };
      const permissionMode = normalizePiPermissionMode(context.permissionMode);
      const tools = permissionMode === 'ask' || permissionMode === 'auto'
        ? [...PI_READ_ONLY_TOOLS, ...PI_WRITE_TOOLS, ...PI_COORDINATION_TOOLS]
        : [...PI_READ_ONLY_TOOLS, ...PI_COORDINATION_TOOLS];
      const settings = {
        globalConfig: false,
        extensions: false,
        packages: false,
        tools,
        permissionMode,
      };
      const resourceProjection = context.resourceProjection && typeof context.resourceProjection === 'object'
        ? context.resourceProjection
        : {};
      const skillProjection = await createTrustedPiSkillProjection(configDir, {
        skills: Array.isArray(resourceProjection.skills) ? resourceProjection.skills : [],
      });
      const mcpServers = (permissionMode === 'ask' || permissionMode === 'auto') && Array.isArray(resourceProjection.mcpServers)
        ? resourceProjection.mcpServers.map(({ name, version, server }) => ({ name, version, ...server }))
        : [];
      const resources = {
        schema: 'medhelp.pi-resource-projection.v1',
        skillPaths: skillProjection.paths,
        skills: skillProjection.manifest,
        mcpServers,
      };
      await Promise.all([
        fs.writeFile(
          path.join(configDir, 'models.json'),
          `${JSON.stringify(modelConfig, null, 2)}\n`,
          { encoding: 'utf8', mode: 0o600 },
        ),
        fs.writeFile(
          path.join(configDir, 'settings.json'),
          `${JSON.stringify(settings, null, 2)}\n`,
          { encoding: 'utf8', mode: 0o600 },
        ),
        fs.writeFile(
          path.join(configDir, 'resources.json'),
          `${JSON.stringify(resources, null, 2)}\n`,
          { encoding: 'utf8', mode: 0o600 },
        ),
      ]);
      return configDir;
    } catch (error) {
      await fs.rm(configDir, { recursive: true, force: true });
      throw error;
    }
  }

  async assertHostAvailable() {
    const diagnostics = await diagnosePiHostLaunch(this.options.launch, {
      protocolVersion: this.options.protocolVersion,
    });
    if (!diagnostics.available) {
      throw createPiRuntimeError(
        diagnostics.status === 'missing' ? 'PI_HOST_NOT_FOUND' : 'PI_HOST_UPGRADE_REQUIRED',
        diagnostics.issues?.[0]?.message || 'Pi Host is unavailable.',
        diagnostics,
      );
    }
    return diagnostics;
  }

  async startHost(context) {
    const sessionKey = typeof context.sessionKey === 'string' ? context.sessionKey.trim() : '';
    if (!sessionKey) {
      throw createPiRuntimeError('PI_HOST_PROTOCOL_ERROR', 'Pi Host requires a composite session key.');
    }
    if (this.records.has(sessionKey)) {
      throw createPiRuntimeError(
        'AGENT_TURN_ALREADY_ACTIVE',
        'A Pi Host is already active for this session.',
        { sessionKey },
      );
    }
    await this.assertHostAvailable();
    const configDir = await this.createTurnConfig(context);
    const secretEnv = normalizeSecretEnvironment(
      context.secretEnv || context.providerConfig?.secretEnv,
    );
    const childEnv = {
      ...pickSafeEnvironment(this.options.env),
      ...this.options.hostEnv,
      ...secretEnv,
      PI_CONFIG_DIR: configDir,
      PI_DISABLE_GLOBAL_CONFIG: '1',
      PI_HOST_PROTOCOL_VERSION: String(this.options.protocolVersion),
    };
    let child;
    try {
      child = this.spawnProcess(
        this.options.launch.command,
        this.options.launch.args,
        {
          cwd: context.projectRoot || os.tmpdir(),
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          detached: process.platform !== 'win32',
        },
      );
    } catch (error) {
      await fs.rm(configDir, { recursive: true, force: true });
      const code = error?.code === 'ENOENT' ? 'PI_HOST_NOT_FOUND' : 'PI_HOST_CRASHED';
      throw createPiRuntimeError(code, error?.message || 'Pi Host failed to start.');
    }

    const client = new PiRpcClient(child, {
      requestTimeoutMs: this.options.requestTimeoutMs,
      maxLineBytes: this.options.maxLineBytes,
      maxStderrBytes: this.options.maxStderrBytes,
    });
    const record = {
      sessionKey,
      identity: context.identity || null,
      child,
      client,
      configDir,
      startedAt: Date.now(),
      stopping: null,
      fatalError: null,
    };
    client.on('event', (event) => context.onEvent?.(event, record));
    client.once('fatal', (error) => {
      record.fatalError = error;
    });
    this.records.set(sessionKey, record);

    try {
      const state = await client.request('initialize', {
        protocolVersion: this.options.protocolVersion,
        configDir,
        provider: context.providerConfig?.providerId || 'faux',
        sdkVersion: PI_SDK_VERSION,
        hostBuildId: PI_HOST_BUILD_ID,
      }, {
        timeoutMs: this.options.startTimeoutMs,
        timeoutCode: 'PI_HOST_START_TIMEOUT',
      });
      if (state?.protocolVersion !== this.options.protocolVersion) {
        throw createPiRuntimeError(
          'PI_HOST_VERSION_MISMATCH',
          `Pi Host protocol ${state?.protocolVersion ?? 'unknown'} does not match required version ${this.options.protocolVersion}.`,
          {
            expectedVersion: this.options.protocolVersion,
            actualVersion: state?.protocolVersion ?? null,
          },
        );
      }
      if (['prepared', 'bundled'].includes(this.options.launch.source) && state?.hostBuildId !== PI_HOST_BUILD_ID) {
        throw createPiRuntimeError(
          'PI_HOST_UPGRADE_REQUIRED',
          `Pi Host build ${state?.hostBuildId ?? 'unknown'} does not match required build ${PI_HOST_BUILD_ID}.`,
        );
      }
      if (['prepared', 'bundled'].includes(this.options.launch.source) && !isSupportedPiNodeVersion(state?.nodeVersion)) {
        throw createPiRuntimeError(
          'PI_NODE_VERSION_UNSUPPORTED',
          `Pi Host requires Node.js >=${PI_MINIMUM_NODE_VERSION}; Host reported ${state?.nodeVersion || 'unknown'}.`,
        );
      }
      return record;
    } catch (error) {
      await this.stopRecord(record);
      throw error;
    }
  }

  async runTurn(context) {
    const record = await this.startHost(context);
    try {
      return await record.client.request(context.method || 'prompt', {
        sessionPath: context.sessionPath,
        agentStatePath: context.agentStatePath,
        sessionId: context.identity?.sessionId || null,
        identity: context.identity || null,
        turnId: context.turnId || null,
        prompt: context.prompt || '',
        projectRoot: context.projectRoot,
        modelId: context.modelId || 'pi-faux-v1',
        sdkProviderId: context.providerConfig?.sdkProviderId || 'faux',
        modelApi: context.providerConfig?.modelApi || 'faux',
        reasoningLevel: context.reasoningLevel || 'off',
        attachments: Array.isArray(context.attachments) ? context.attachments : [],
        permissionMode: normalizePiPermissionMode(context.permissionMode),
        approvalTimeoutMs: Number.isFinite(context.approvalTimeoutMs)
          ? context.approvalTimeoutMs
          : undefined,
        delayMs: Number.isFinite(context.delayMs) ? context.delayMs : undefined,
        ...(context.params && typeof context.params === 'object' ? context.params : {}),
      }, {
        timeoutMs: context.timeoutMs ?? this.options.requestTimeoutMs,
      });
    } finally {
      await this.stopRecord(record);
    }
  }

  async steer(sessionKey, command) {
    const record = this.records.get(sessionKey);
    if (!record || record.stopping) return false;
    await record.client.request('steer', { prompt: String(command || '') });
    return true;
  }

  async resolveToolApproval(sessionKey, approvalId, decision = {}) {
    const record = this.records.get(sessionKey);
    if (!record || record.stopping) return false;
    const result = await record.client.request('tool_approval', {
      approvalId,
      allow: decision.allow === true,
      reason: typeof decision.reason === 'string' ? decision.reason : null,
      updatedInput: decision.updatedInput && typeof decision.updatedInput === 'object'
        ? decision.updatedInput
        : null,
    }, {
      timeoutMs: this.options.abortTimeoutMs,
      timeoutCode: 'PI_TOOL_APPROVAL_BRIDGE_FAILED',
    });
    return result?.accepted === true;
  }

  async getState(sessionKey) {
    const record = this.records.get(sessionKey);
    if (!record || record.stopping) return null;
    return record.client.request('get_state');
  }

  async resolveServiceTool(sessionKey, requestId, result, error = null) {
    const record = this.records.get(sessionKey);
    if (!record || record.stopping) return false;
    return record.client.request('runtime_tool_result', { requestId, result, error });
  }

  async abort(sessionKey) {
    const record = this.records.get(sessionKey);
    if (!record) return false;
    if (record.stopping) {
      await record.stopping;
      return true;
    }
    const abortResult = await createTimeout(
      record.client.request('abort', {}, {
        timeoutMs: this.options.abortTimeoutMs,
        timeoutCode: 'PI_HOST_ABORT_TIMEOUT',
      }).then(() => true, () => false),
      this.options.abortTimeoutMs + 25,
      false,
    );
    await this.stopRecord(record);
    if (!abortResult) {
      throw createPiRuntimeError(
        'PI_HOST_ABORT_TIMEOUT',
        'Pi Host did not acknowledge abort before termination.',
      );
    }
    return true;
  }

  async stopRecord(record) {
    if (record.stopping) return record.stopping;
    record.stopping = (async () => {
      record.client.expectProcessExit();
      if (record.child.exitCode == null && record.child.signalCode == null) {
        if (!record.child.killed) {
          try {
            record.child.stdin.end();
          } catch {}
        }
        const exited = await createTimeout(
          record.client.waitForExit().then(() => true),
          this.options.terminateTimeoutMs,
          false,
        );
        if (!exited) {
          if (!record.child.killed) {
            terminateHostTree(record.child, 'SIGTERM');
          }
          const terminated = await createTimeout(
            record.client.waitForExit().then(() => true),
            this.options.terminateTimeoutMs,
            false,
          );
          if (!terminated) {
            terminateHostTree(record.child, 'SIGKILL');
            await createTimeout(
              record.client.waitForExit(),
              this.options.terminateTimeoutMs,
              null,
            );
          }
        }
      }
      record.client.close();
      if (this.records.get(record.sessionKey) === record) this.records.delete(record.sessionKey);
      await fs.rm(record.configDir, { recursive: true, force: true });
    })();
    return record.stopping;
  }

  isActive(sessionKey) {
    const record = this.records.get(sessionKey);
    return Boolean(record && !record.stopping);
  }

  getActiveSessions() {
    return [...this.records.values()]
      .filter((record) => !record.stopping)
      .map((record) => record.sessionKey);
  }

  getStartTime(sessionKey) {
    return this.records.get(sessionKey)?.startedAt ?? null;
  }

  async diagnostics() {
    const runtime = await diagnosePiHostLaunch(this.options.launch, {
      protocolVersion: this.options.protocolVersion,
    });
    return {
      ...runtime,
      protocolVersion: this.options.protocolVersion,
      sdkVersion: PI_SDK_VERSION,
      provider: this.isFauxHost() ? 'faux' : 'pi-sdk',
      hostPath: this.options.launch.hostPath,
      activeHosts: this.getActiveSessions().length,
    };
  }

  isFauxHost() {
    return this.options.launch.hostPath === path.resolve(DEFAULT_FAUX_HOST_PATH)
      || this.options.launch.hostPath?.endsWith(`${path.sep}pi-faux-host.mjs`)
      || this.options.launch.hostPath?.endsWith(`${path.sep}faux-host.mjs`);
  }

  async shutdown() {
    const records = [...this.records.values()];
    await Promise.allSettled(records.map((record) => this.abort(record.sessionKey)));
  }
}

export function createPiHostManager(options = {}) {
  return new PiHostManager(options);
}

export { DEFAULT_FAUX_HOST_PATH };

export default PiHostManager;
