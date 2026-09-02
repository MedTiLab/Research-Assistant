import express from 'express';

import { piRuntime } from '../agent-runtime/pi-runtime.js';
import {
  deletePiProvider,
  discoverPiProviderModels,
  listEnabledPiModels,
  listPiProviderModels,
  listPiProviders,
  listPiTaskModels,
  savePiProviderModels,
  setActivePiProvider,
  testPiProviderConnection,
  upsertPiProvider,
} from '../pi-runtime/provider-store.js';
import { resolveRequestUserId } from '../utils/userScope.js';
import { createAgentServicesRouter } from './agent-services.js';
import { createPiResourcesRouter } from './pi-resources.js';
import { createMcpBundleInstallHandler } from './mcp.js';

const router = express.Router();
// These routes also travel through /api/local/pi for desktop local-kernel sessions.
router.use('/services', createAgentServicesRouter());
router.use(createPiResourcesRouter());
router.post('/mcp/bundle/install', createMcpBundleInstallHandler({ target: 'pi' }));

function requestUserId(req) {
  return resolveRequestUserId(req);
}

function sendPiRouteError(res, error, fallbackCode) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (status >= 500) console.error(`[ERROR] ${fallbackCode}:`, error?.message || error);
  return res.status(status).json({
    success: false,
    error: {
      code: error?.code || fallbackCode,
      message: error?.message || 'Pi provider request failed.',
    },
  });
}

router.get('/providers', (req, res) => {
  try {
    res.json({ success: true, ...listPiProviders(requestUserId(req)) });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_PROVIDER_LIST_FAILED');
  }
});

router.post('/providers/test', async (req, res) => {
  try {
    const result = await testPiProviderConnection(requestUserId(req), req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_PROVIDER_TEST_FAILED');
  }
});

router.post('/providers', (req, res) => {
  try {
    const provider = upsertPiProvider(requestUserId(req), req.body || {});
    res.status(req.body?.id ? 200 : 201).json({ success: true, provider });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_PROVIDER_SAVE_FAILED');
  }
});

router.delete('/providers/:providerId', (req, res) => {
  try {
    const deleted = deletePiProvider(requestUserId(req), req.params.providerId);
    if (!deleted) return res.status(404).json({
      success: false,
      error: { code: 'PI_PROVIDER_NOT_FOUND', message: 'Pi provider was not found.' },
    });
    return res.json({ success: true });
  } catch (error) {
    return sendPiRouteError(res, error, 'PI_PROVIDER_DELETE_FAILED');
  }
});

router.put('/providers/:providerId/active', (req, res) => {
  try {
    const provider = setActivePiProvider(requestUserId(req), req.params.providerId);
    res.json({ success: true, provider });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_PROVIDER_ACTIVATE_FAILED');
  }
});

router.get('/providers/:providerId/models', (req, res) => {
  try {
    res.json({ success: true, ...listPiProviderModels(requestUserId(req), req.params.providerId) });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_PROVIDER_MODELS_FAILED');
  }
});

router.put('/providers/:providerId/models', (req, res) => {
  try {
    const models = savePiProviderModels(requestUserId(req), req.params.providerId, req.body || {});
    res.json({ success: true, ...models });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_PROVIDER_MODELS_SAVE_FAILED');
  }
});

router.post('/providers/:providerId/models/refresh', async (req, res) => {
  try {
    const models = await discoverPiProviderModels(requestUserId(req), req.params.providerId);
    res.json({ success: true, ...models });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_PROVIDER_DISCOVERY_FAILED');
  }
});

function sendActiveModelCatalog(req, res) {
  try {
    const models = listEnabledPiModels(requestUserId(req));
    res.json({
      success: true,
      configured: models.length > 0,
      health: models.length > 0 ? 'healthy' : 'unavailable',
      models,
    });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_PROVIDER_MODELS_FAILED');
  }
}

router.get('/models', sendActiveModelCatalog);
// Discovery stays on the explicit per-provider settings endpoint. Refreshing
// the composer only reloads the signed-in account's enabled models.
router.post('/models/refresh', sendActiveModelCatalog);

router.get('/models/tasks/:task', (req, res) => {
  try {
    const models = listPiTaskModels(requestUserId(req), req.params.task);
    res.json({ success: true, task: req.params.task, models });
  } catch (error) {
    sendPiRouteError(res, error, 'PI_TASK_MODELS_FAILED');
  }
});

router.get('/status', async (req, res) => {
  try {
    const diagnostics = await piRuntime.native.diagnostics({ userId: requestUserId(req) });
    res.json({
      success: true,
      runtimeId: 'pi',
      ...diagnostics,
    });
  } catch (error) {
    console.error('[ERROR] Failed to load Pi runtime diagnostics:', error.message);
    res.status(500).json({
      success: false,
      runtimeId: 'pi',
      configured: false,
      error: error.message,
    });
  }
});

export default router;
