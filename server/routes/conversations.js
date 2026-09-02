import express from 'express';

import { accountConversationDb } from '../database/db.js';
import { buildSessionDisplayName, stripInternalContextPrefix } from '../utils/sessionFormatting.js';
import { buildVisibleConversationMessages } from '../utils/conversationSnapshots.js';

const router = express.Router();
const SUPPORTED_PROVIDERS = new Set(['claude', 'codex', 'openrouter', 'local']);

function normalizeProvider(provider) {
  const normalized = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  return SUPPORTED_PROVIDERS.has(normalized) ? normalized : 'claude';
}

router.get('/', (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query?.offset, 10) || 0);
    const search = typeof req.query?.search === 'string' ? req.query.search.trim() : '';
    const result = accountConversationDb.listForUser(req.user.id, { limit, offset, search });
    res.json(result);
  } catch (error) {
    console.error('Error listing account conversations:', error);
    res.status(500).json({ error: 'Failed to list account conversations' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const conversation = accountConversationDb.getForUser(req.user.id, req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    return res.json({ conversation });
  } catch (error) {
    console.error('Error reading account conversation:', error);
    return res.status(500).json({ error: 'Failed to read account conversation' });
  }
});

router.put('/session/:sessionId', (req, res) => {
  try {
    const sessionId = typeof req.params?.sessionId === 'string' ? req.params.sessionId.trim() : '';
    const provider = normalizeProvider(req.body?.provider);
    const messages = buildVisibleConversationMessages(
      Array.isArray(req.body?.messages) ? req.body.messages : [],
    );
    if (!sessionId || sessionId.startsWith('new-session-')) {
      return res.status(400).json({ error: 'A persisted sessionId is required' });
    }
    if (messages.length === 0) {
      return res.status(400).json({ error: 'No visible messages found for this session' });
    }

    const requestedTitle = typeof req.body?.title === 'string'
      ? stripInternalContextPrefix(req.body.title.trim(), false) || ''
      : '';
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const title = (requestedTitle || buildSessionDisplayName(firstUserMessage?.content || '', 120) || 'Conversation')
      .slice(0, 160);
    const projectLabel = typeof req.body?.projectLabel === 'string'
      ? req.body.projectLabel.trim().slice(0, 160)
      : '';

    const conversation = accountConversationDb.upsert({
      userId: req.user.id,
      sessionId,
      provider,
      runtimeId: req.body?.runtimeId || null,
      sessionKey: req.body?.sessionKey || null,
      projectKey: req.body?.projectKey || null,
      title,
      projectLabel: projectLabel || null,
      messages,
    });
    return res.json({ conversation });
  } catch (error) {
    console.error('Error syncing account conversation:', error);
    return res.status(500).json({ error: 'Failed to save account conversation' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const deleted = accountConversationDb.deleteForUser(req.user.id, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting account conversation:', error);
    return res.status(500).json({ error: 'Failed to delete account conversation' });
  }
});

export default router;
