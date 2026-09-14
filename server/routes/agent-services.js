import express from 'express';
import { piRuntime } from '../agent-runtime/pi-runtime.js';
import { serviceStatePath, readServiceState, mutateServiceState } from '../agent-runtime/durable-store.js';
import { addPermissionPresets } from '../agent-runtime/permission-rules.js';
import { resolveRequestUserId } from '../utils/userScope.js';
import { PI_GLOBAL_INTEGRATIONS_PROJECT_KEY } from '../agent-runtime/integrations.js';
import { indexAutomationSession } from '../agent-runtime/automation-results.js';

export function createAgentServicesRouter({ services = piRuntime.native.toolServices, storageOptions = {}, indexRun = indexAutomationSession } = {}) {
  const router = express.Router();
  const indexedRuns = new Map();
  const contextFor = (req) => {
    const scope = String(req.query.scope || req.body?.scope || 'local');
    if (!['user', 'local'].includes(scope)) throw new Error('scope must be user or local');
    const requestedProject = String(req.query.projectKey || req.body?.projectKey || '').trim();
    if (scope === 'local' && (!requestedProject || requestedProject.length > 2000)) throw new Error('projectKey is required for local scope');
    const projectKey = scope === 'user' ? PI_GLOBAL_INTEGRATIONS_PROJECT_KEY : requestedProject;
    const userId = resolveRequestUserId(req);
    if (userId == null) throw new Error('User context is required');
    return { identity: { ownerKey: String(userId), projectKey, runtimeId: 'pi', sessionId: 'settings' }, userId, storageOptions, settingsScope: scope };
  };
  router.get('/integrations', async (req, res) => {
    try { res.json(await services.integrations.list(contextFor(req), { includeConfig: true })); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/integrations', async (req, res) => {
    try { res.json(await services.integrations.configure(req.body, contextFor(req))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.delete('/integrations/:id', async (req, res) => {
    try { res.json(await services.integrations.remove(req.params.id, contextFor(req))); }
    catch (error) { console.error('[ERROR] Remove integration:', error.message); res.status(400).json({ error: error.message }); }
  });
  router.get('/integrations/:id/tools', async (req, res) => {
    try { res.json(await services.integrations.execute('integration_tools', { integration_id: req.params.id }, contextFor(req))); }
    catch (error) { console.error('[ERROR] Inspect integration tools:', error.message); res.status(400).json({ error: error.message }); }
  });
  router.post('/integrations/:id/:action', async (req, res) => {
    try {
      const name = { reconnect: 'mcp_reconnect', authorize: 'mcp_authorize' }[req.params.action];
      if (!name) return res.status(404).json({ error: 'Unknown integration action' });
      res.json(await services.integrations.execute(name, { integration_id: req.params.id, reauthorize: req.body?.reauthorize === true }, contextFor(req)));
    } catch (error) { console.error('[ERROR] Agent integration:', error.message); res.status(400).json({ error: error.message }); }
  });
  router.get('/permissions', async (req, res) => {
    try { res.json(await readServiceState(serviceStatePath(contextFor(req).identity, 'permissions', storageOptions))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/permissions/presets', async (req, res) => {
    try { res.json(await addPermissionPresets(contextFor(req).identity, req.body?.presetIds, storageOptions)); }
    catch (error) { console.error('[ERROR] Pi permission presets:', error.message); res.status(400).json({ error: error.message }); }
  });
  router.delete('/permissions/:id', async (req, res) => {
    try { await mutateServiceState(serviceStatePath(contextFor(req).identity, 'permissions', storageOptions), (rows) => rows.filter((row) => row.id !== req.params.id)); res.json({ success: true }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.get('/automations', async (req, res) => {
    try { res.json(await services.automations.execute('automation_list', {}, contextFor(req))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.get('/automations/inbox', async (req, res) => {
    try {
      const ownerKey = resolveRequestUserId(req);
      if (ownerKey == null) return res.status(401).json({ error: 'Authentication required' });
      const items = await services.automations.inbox(String(ownerKey), storageOptions);
      // Recover old background sessions into the same index as normal chats.
      for (const item of items) {
        const key = `${ownerKey}:${item.projectKey}:${item.sessionId}`;
        if (indexedRuns.get(key) === item.status) continue;
        try {
          await indexRun({ id: item.automationId, title: item.title, identity: { ownerKey: String(ownerKey), projectKey: item.projectKey, runtimeId: 'pi' } }, item, storageOptions);
          indexedRuns.set(key, item.status);
        } catch (error) { console.error('[ERROR] Index automation conversation:', error.message); }
        if (indexedRuns.size > 1000) indexedRuns.delete(indexedRuns.keys().next().value);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(items);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.get('/automations/:id/runs', async (req, res) => {
    try { res.json(await services.automations.execute('automation_runs', { automation_id: req.params.id }, contextFor(req))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.get('/automations/:id/runs/:sessionId', async (req, res) => {
    try {
      const context = contextFor(req);
      const result = await services.automations.execute('automation_result', { automation_id: req.params.id, session_id: req.params.sessionId }, context);
      const record = (await services.automations.execute('automation_list', {}, context)).find((row) => row.id === req.params.id);
      try { await indexRun(record, result, storageOptions); }
      catch (error) { console.error('[ERROR] Index automation conversation:', error.message); }
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/automations/:id/runs/:sessionId/read', async (req, res) => {
    try { res.json(await services.automations.execute('automation_ack', { automation_id: req.params.id, session_id: req.params.sessionId }, contextFor(req))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/automations', async (req, res) => {
    try {
      res.status(201).json(await services.automations.execute('automation_create', {
        title: req.body?.title,
        prompt: req.body?.prompt,
        at: req.body?.at,
        interval_minutes: req.body?.intervalMinutes,
        model: req.body?.model,
        permission_mode: req.body?.permissionMode,
      }, contextFor(req)));
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.patch('/automations/:id', async (req, res) => {
    try {
      const input = { automation_id: req.params.id };
      if (Object.hasOwn(req.body || {}, 'status')) input.status = req.body.status;
      if (Object.hasOwn(req.body || {}, 'title')) input.title = req.body.title;
      if (Object.hasOwn(req.body || {}, 'prompt')) input.prompt = req.body.prompt;
      if (Object.hasOwn(req.body || {}, 'at')) input.at = req.body.at;
      if (Object.hasOwn(req.body || {}, 'intervalMinutes')) input.interval_minutes = req.body.intervalMinutes;
      if (Object.hasOwn(req.body || {}, 'model')) input.model = req.body.model;
      if (Object.hasOwn(req.body || {}, 'permissionMode')) input.permission_mode = req.body.permissionMode;
      res.json(await services.automations.execute('automation_update', input, contextFor(req)));
    }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/automations/:id/run', async (req, res) => {
    try { res.status(202).json(await services.automations.execute('automation_run', { automation_id: req.params.id }, contextFor(req))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.delete('/automations/:id', async (req, res) => {
    try { res.json(await services.automations.execute('automation_delete', { automation_id: req.params.id }, contextFor(req))); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  return router;
}
export default createAgentServicesRouter();
