import express from 'express';
import { promises as fs } from 'node:fs';
import { createAgentSessionIdentity } from '../utils/agentSessionIdentity.js';
import { resolvePiSessionPath } from '../pi-runtime/session-store.js';
import { piRuntime } from '../agent-runtime/pi-runtime.js';
import { piModelCatalog } from '../services/pi-model-catalog.js';
import { resolveAgentRuntimeStatePath } from '../agent-runtime/state-store.js';
import { resolveRequestUserId } from '../utils/userScope.js';

// A persisted, owner-scoped Pi session can precede the optional project index.
// Only use the fallback after the router has verified that session on disk.
export function createPiSessionProjectResolver({ getProject, resolveDirectory, validatePath }) {
  return async (projectName, userId, { hasSession = false, localKernel = false } = {}) => {
    const project = await getProject(projectName);
    // Desktop projects use the local database's owner namespace. The cloud
    // account is separately checked against the owner-scoped session file.
    if (!localKernel && project?.user_id != null && String(project.user_id) !== String(userId)) return null;
    if (!project && !hasSession) return null;
    const projectPath = project?.path || await resolveDirectory(projectName);
    if (!projectPath) return null;
    const validation = await validatePath(projectPath, userId);
    return validation.valid ? validation.resolvedPath || projectPath : null;
  };
}

async function fileExists(file) {
  try { await fs.access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function createPiSessionsRouter({ runtime = piRuntime, resolveProject, storageOptions = {}, resolveManagedModel = (selection) => piModelCatalog.resolveProviderConfig(selection) } = {}) {
  const router = express.Router();
  const base = '/projects/:projectName/sessions/:sessionId';
  const handle = (action, { allowPendingTranscript = false } = {}) => async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (userId == null) return res.status(401).json({ error: 'Authentication required' });
      if (!/^[a-zA-Z0-9._-]{1,200}$/.test(req.params.sessionId)) return res.status(400).json({ error: 'Invalid session id' });
      const identity = createAgentSessionIdentity({ ownerKey: String(userId), projectKey: req.params.projectName, runtimeId: 'pi', sessionId: req.params.sessionId });
      const hasSession = await fileExists(resolvePiSessionPath(identity, storageOptions))
        || allowPendingTranscript && await fileExists(resolveAgentRuntimeStatePath(identity, storageOptions));
      if (!hasSession) return res.status(404).json({ error: 'Pi session not found', code: 'PI_SESSION_NOT_FOUND' });
      const projectRoot = await resolveProject(req.params.projectName, userId, { hasSession, localKernel: Boolean(req.localKernelSession) });
      if (!projectRoot) return res.status(404).json({ error: 'Project not found or unavailable', code: 'PI_PROJECT_UNAVAILABLE' });
      const context = { identity, userId, projectRoot, projectPath: projectRoot, storageOptions, permissionMode: 'ask' };
      await action(req, res, context);
    } catch (error) {
      const status = error?.code === 'ENOENT' || error?.code === 'PI_TASK_NOT_FOUND' ? 404
        : ['AGENT_TURN_ALREADY_ACTIVE', 'PI_TASK_NOT_RETRYABLE'].includes(error?.code) ? 409 : 400;
      console.error('[ERROR] Pi session operation:', error?.message);
      res.status(status).json({ error: error?.message || 'Pi session operation failed' });
    }
  };
  router.get(`${base}/state`, handle(async (req, res, context) => {
    const { identity, updatedAt, tasks, todos, artifacts, contextItems, plan } = await runtime.native.sessionState(context.identity, context);
    res.json({ identity, updatedAt, tasks, todos, artifacts, contextItems, plan });
  }, { allowPendingTranscript: true }));
  router.get(`${base}/branches`, handle(async (req, res, context) => {
    res.json(await runtime.native.branches(context.identity, context));
  }));
  router.post(`${base}/branches/:action`, handle(async (req, res, context) => {
    const { action } = req.params;
    if (!['create', 'switch'].includes(action)) return res.status(404).json({ error: 'Unknown branch action' });
    const input = req.body || {};
    const id = action === 'create' ? input.entryId : input.branchId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(id) || (input.label != null && (typeof input.label !== 'string' || input.label.length > 100))) return res.status(400).json({ error: 'Invalid branch selection' });
    res.json(await runtime.native.changeBranch(context.identity, action, { entryId: input.entryId, branchId: input.branchId, label: input.label }, context));
  }));
  router.post(`${base}/tasks/:taskId/:action`, handle(async (req, res, context) => {
    const operation = { cancel: runtime.native.cancelTask, retry: runtime.native.retryTask }[req.params.action];
    if (!['cancel', 'retry'].includes(req.params.action)) return res.status(404).json({ error: 'Unknown task action' });
    res.json({ task: await operation(context.identity, req.params.taskId, context) });
  }));
  router.post(`${base}/compact`, handle(async (req, res, context) => {
    const state = await runtime.native.sessionState(context.identity, context);
    const savedModel = state.runs?.at(-1)?.model || {};
    const selection = { modelProviderId: savedModel.modelProviderId || req.body?.modelProviderId, modelId: savedModel.modelId || req.body?.model, modelApi: savedModel.modelApi || req.body?.modelApi };
    if (Object.values(selection).some((value) => value != null && (typeof value !== 'string' || value.length > 300))) return res.status(400).json({ error: 'Invalid model selection' });
    const options = { ...context, ...selection, model: selection.modelId };
    if (selection.modelProviderId === 'managed-free') options.piProviderConfig = await resolveManagedModel(selection);
    res.json(await runtime.native.compact(context.identity, options));
  }));
  router.get(`${base}/terminals`, handle(async (req, res, context) => {
    res.json(await runtime.native.toolServices.execute('terminal_list', {}, context));
  }));
  router.get(`${base}/terminals/:terminalId`, handle(async (req, res, context) => {
    res.json(await runtime.native.toolServices.execute('terminal_read', { terminal_id: req.params.terminalId, cursor: Number(req.query.cursor) || 0 }, context));
  }));
  router.post(`${base}/terminals/:terminalId/:action`, handle(async (req, res, context) => {
    if (!['input', 'close'].includes(req.params.action)) return res.status(404).json({ error: 'Unknown terminal action' });
    res.json(await runtime.native.toolServices.execute(req.params.action === 'input' ? 'terminal_write' : 'terminal_close', { terminal_id: req.params.terminalId, input: req.body?.input }, context));
  }));
  return router;
}
