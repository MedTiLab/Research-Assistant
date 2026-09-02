import express from 'express';

import {
  cancelAgentRun,
  getAgentRun,
  getAgentRunEngineStatus,
  listAgentRuns,
} from '../agent-runtime/index.js';

function publicRun(run) {
  if (!run) return null;
  const { request, leaseToken, ...visible } = run;
  return visible;
}

export function createAgentRunsRouter({
  cancel = cancelAgentRun,
  get = getAgentRun,
  engineStatus = getAgentRunEngineStatus,
  list = listAgentRuns,
} = {}) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const ownerKey = String(req.user.id);
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const status = typeof req.query.status === 'string' && req.query.status.trim()
        ? req.query.status.trim()
        : undefined;
      const runs = list({ ownerKey, status, limit }).map(publicRun);
      res.json({ success: true, runs, engine: engineStatus() });
    } catch (error) {
      console.error('[ERROR] List agent runs:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/:runId', async (req, res) => {
    try {
      const run = get(req.params.runId);
      if (!run || run.ownerKey !== String(req.user.id)) {
        return res.status(404).json({ error: 'Agent run not found' });
      }
      return res.json({ success: true, run: publicRun(run) });
    } catch (error) {
      console.error('[ERROR] Get agent run:', error.message);
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/:runId/cancel', async (req, res) => {
    try {
      const ownerKey = String(req.user.id);
      const cancelled = await cancel(req.params.runId, ownerKey);
      if (!cancelled) return res.status(404).json({ error: 'Active agent run not found' });
      return res.json({ success: true, run: publicRun(get(req.params.runId)) });
    } catch (error) {
      console.error('[ERROR] Cancel agent run:', error.message);
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default createAgentRunsRouter();
