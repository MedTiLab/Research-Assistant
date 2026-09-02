import express from 'express';
import { piRuntime } from '../agent-runtime/pi-runtime.js';
import { serviceStatePath, readServiceState, mutateServiceState } from '../agent-runtime/durable-store.js';
import { addPermissionPresets } from '../agent-runtime/permission-rules.js';
import { resolveRequestUserId } from '../utils/userScope.js';
import { PI_GLOBAL_INTEGRATIONS_PROJECT_KEY } from '../agent-runtime/integrations.js';

export function createAgentServicesRouter({ services = piRuntime.native.toolServices, storageOptions = {} } = {}) {
  const router = express.Router();
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
  router.post('/automations', async (req, res) => {
    try {
      res.status(201).json(await services.automations.execute('automation_create', {
        title: req.body?.title,
        prompt: req.body?.prompt,
        at: req.body?.at,
        interval_minutes: req.body?.intervalMinutes,
        model: req.body?.model,
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
