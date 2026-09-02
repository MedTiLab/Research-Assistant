import express from 'express';
import { access } from 'node:fs/promises';
import { getTrashedSessions } from '../projects.js';
import { resolvePiSessionPath } from '../pi-runtime/session-store.js';
import { resolveAgentRuntimeStatePath } from '../agent-runtime/state-store.js';
import { resolveRequestUserId } from '../utils/userScope.js';
import { resolveApiSessionTarget, sessionOperationError } from '../utils/apiSessionTarget.js';
import { recordIndexedSession } from '../utils/sessionIndex.js';
import { forkedSessionTitle } from '../utils/sessionForking.js';

async function exists(file) {
  try { await access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function createSessionManagementRouter({ registry, getSessionStatus }) {
  const router = express.Router();
  const base = '/:projectName/sessions/:sessionId';
  const handle = (action) => async (req, res) => {
    try {
      const { projectName, sessionId } = req.params;
      const provider = req.body?.provider || req.query.provider || req.body?.runtimeId || req.query.runtimeId;
      const target = resolveApiSessionTarget(req, projectName, sessionId, provider);
      if (target.identity.runtimeId === 'pi' && !target.indexedSession
        && !await exists(resolvePiSessionPath(target.identity))
        && !await exists(resolveAgentRuntimeStatePath(target.identity))) {
        throw sessionOperationError('Pi session not found', 404);
      }
      const result = await action(req, target);
      res.json(result ?? { success: true });
    } catch (error) {
      console.error('[ERROR] Session operation:', error.message);
      const status = error.status || error.statusCode || (error.code === 'AGENT_SESSION_IDENTITY_CONFLICT' ? 409 : 500);
      res.status(status).json({ error: error.message });
    }
  };
  router.put(`${base}/rename`, handle(async (req, { identity, options }) => {
    if (typeof req.body?.summary !== 'string' || !req.body.summary.trim()) {
      throw sessionOperationError('New session name cannot be empty', 400);
    }
    await registry.require(identity.runtimeId).rename(identity, req.body.summary.trim(), options);
  }));
  router.get(`${base}/fork-points`, handle(async (req, target) => {
    const { identity, project, options } = target;
    const store = registry.require(identity.runtimeId);
    const points = await store.forkPoints(identity, {
      ...options,
      projectPath: project.path,
      projectRoot: project.path,
      userId: resolveRequestUserId(req),
    });
    return { success: true, points: Array.isArray(points) ? points : [] };
  }));
  router.post(`${base}/fork`, handle(async (req, target) => {
    const { identity, indexedSession, project, options } = target;
    let pointId = typeof req.body?.pointId === 'string' ? req.body.pointId.trim() : '';
    const responseFromEnd = Number(req.body?.responseFromEnd);
    if (pointId.length > 300) throw sessionOperationError('Choose a valid fork point.', 400);
    if (!pointId) {
      if (!Number.isInteger(responseFromEnd) || responseFromEnd < 1 || responseFromEnd > 10_000) {
        throw sessionOperationError('Choose a valid conversation response.', 400);
      }
      const forkPointResult = await registry.require(identity.runtimeId).forkPoints(identity, {
        ...options,
        projectPath: project.path,
        projectRoot: project.path,
        userId: resolveRequestUserId(req),
      });
      const forkPoints = Array.isArray(forkPointResult) ? forkPointResult : [];
      pointId = forkPoints?.[forkPoints.length - responseFromEnd]?.id || '';
      if (!pointId) throw sessionOperationError('This response is not available as a fork point.', 409);
    }
    if (getSessionStatus(identity).isActive) {
      throw sessionOperationError('Wait for the current turn to finish before forking this conversation.', 409);
    }
    const title = forkedSessionTitle(indexedSession);
    const result = await registry.require(identity.runtimeId).fork(identity, { pointId, title }, {
      ...options,
      projectPath: project.path,
      projectRoot: project.path,
      userId: resolveRequestUserId(req),
    });
    if (!result?.sessionId) throw sessionOperationError('The provider did not create a forked conversation.', 500);
    const inheritedStageTagKeys = Array.isArray(indexedSession?.tags)
      ? indexedSession.tags.filter((tag) => tag?.tagType === 'stage').map((tag) => tag.tagKey).filter(Boolean)
      : [];
    recordIndexedSession({
      sessionId: result.sessionId,
      provider: options.provider || identity.runtimeId,
      projectPath: project.path,
      sessionMode: indexedSession?.metadata?.sessionMode || indexedSession?.mode || 'research',
      displayName: title,
      stageTagKeys: inheritedStageTagKeys,
      tagSource: 'conversation_fork',
    });
    return {
      success: true,
      session: {
        id: result.sessionId,
        sessionId: result.sessionId,
        runtimeId: identity.runtimeId,
        projectKey: identity.projectKey,
        summary: title,
        name: title,
        title,
        mode: indexedSession?.metadata?.sessionMode || indexedSession?.mode || 'research',
        tags: Array.isArray(indexedSession?.tags) ? indexedSession.tags : [],
        messageCount: 0,
        lastActivity: new Date().toISOString(),
        __provider: options.provider || identity.runtimeId,
      },
    };
  }));
  router.delete(base, handle(async (req, { identity, options }) => {
    const mode = req.query.mode || 'trash';
    if (!['trash', 'physical'].includes(mode)) throw sessionOperationError('Invalid deletion mode', 400);
    // A legacy index can retain the local owner while its current turn uses the
    // paired account. Neither identity may be deleted while it is processing.
    const currentIdentity = { ...identity, ownerKey: String(resolveRequestUserId(req)) };
    if (getSessionStatus(identity).isActive || getSessionStatus(currentIdentity).isActive) {
      throw sessionOperationError('Session is currently processing and cannot be deleted yet.', 409);
    }
    await registry.require(identity.runtimeId)[mode === 'physical' ? 'delete' : 'trash'](identity, options);
  }));
  router.post(`${base}/restore`, handle(async (_req, { identity, options }) => {
    await registry.require(identity.runtimeId).restore(identity, options);
  }));
  router.get('/trash/sessions', async (req, res) => {
    try {
      res.json(await getTrashedSessions(req.user?.id ?? null, { sessionOwnerKey: resolveRequestUserId(req) }));
    } catch (error) {
      console.error('[ERROR] List trashed sessions:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
  return router;
}
