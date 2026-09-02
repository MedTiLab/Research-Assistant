import express from 'express';

import {
  detectEnvironmentSetup,
  getEnvironmentSetupStatus,
  saveEnvironmentSetup,
  validateEnvironmentSetup,
} from '../utils/environmentSetup.js';

const router = express.Router();

function sendSetupError(res, error, fallbackMessage) {
  console.error('[environment-setup]', error);
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallbackMessage,
    fieldErrors: error.fieldErrors || undefined,
  });
}

router.get('/', async (_req, res) => {
  try {
    return res.json(await getEnvironmentSetupStatus());
  } catch (error) {
    return sendSetupError(res, error, '读取本机环境配置失败');
  }
});

router.post('/detect', async (_req, res) => {
  try {
    return res.json(await detectEnvironmentSetup());
  } catch (error) {
    return sendSetupError(res, error, '检测本机环境失败');
  }
});

router.post('/validate', async (req, res) => {
  try {
    const result = await validateEnvironmentSetup(req.body || {}, { createDirectories: true });
    return res.status(result.valid ? 200 : 400).json(result);
  } catch (error) {
    return sendSetupError(res, error, '校验本机环境配置失败');
  }
});

router.put('/', async (req, res) => {
  try {
    return res.json({ success: true, ...(await saveEnvironmentSetup(req.body || {})) });
  } catch (error) {
    return sendSetupError(res, error, '保存本机环境配置失败');
  }
});

export default router;
