import express from 'express';
import { feedbackDb } from '../database/db.js';

const router = express.Router();

const MAX_MESSAGE_LENGTH = 5000;
const MAX_CONTACT_LENGTH = 300;
const MAX_METADATA_BYTES = 20000;

function normalizeOptionalString(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_BYTES) {
    return { truncated: true };
  }

  return value;
}

router.post('/', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'Feedback message is required' });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Feedback message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    }

    const submission = feedbackDb.create({
      userId: req.user.id,
      projectName: normalizeOptionalString(req.body?.projectName, 300),
      projectPath: normalizeOptionalString(req.body?.projectPath, 2000),
      sessionId: normalizeOptionalString(req.body?.sessionId, 300),
      sessionKey: normalizeOptionalString(req.body?.sessionKey, 1200),
      projectKey: normalizeOptionalString(req.body?.projectKey, 300),
      runtimeId: normalizeOptionalString(req.body?.runtimeId, 50),
      provider: normalizeOptionalString(req.body?.provider, 50),
      message,
      contact: normalizeOptionalString(req.body?.contact, MAX_CONTACT_LENGTH),
      pageUrl: normalizeOptionalString(req.body?.pageUrl, 2000),
      userAgent: normalizeOptionalString(req.get('user-agent') || '', 1000),
      metadata: normalizeMetadata(req.body?.metadata),
    });

    return res.status(201).json({
      success: true,
      feedback: {
        id: submission.id,
        createdAt: submission.createdAt,
      },
    });
  } catch (error) {
    console.error('[feedback] Failed to save feedback:', error);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
});

router.get('/', async (req, res) => {
  try {
    const limit = req.query?.limit ? Number(req.query.limit) : 50;
    return res.json({
      feedback: feedbackDb.listForUser(req.user.id, limit),
    });
  } catch (error) {
    console.error('[feedback] Failed to list feedback:', error);
    return res.status(500).json({ error: 'Failed to list feedback' });
  }
});

export default router;
