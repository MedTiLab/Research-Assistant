import express from 'express';
import {
  conversationShareDb,
  projectDb,
  sessionDb,
  userDb,
} from '../database/db.js';
import { authenticateToken, verifyAccessToken } from '../middleware/auth.js';
import { IS_PLATFORM } from '../constants/config.js';
import { runtimeSessionStoreRegistry } from '../agent-runtime/index.js';
import { createAgentSessionIdentity } from '../utils/agentSessionIdentity.js';
import {
  buildSessionDisplayName,
} from '../utils/sessionFormatting.js';
import { isCodexInternalPromptContent } from '../../shared/codexInternalNotices.js';
import {
  buildVisibleConversationMessages,
  isSkillInstructionContent,
  normalizeTimestamp,
  normalizeVisibleUserText,
} from '../utils/conversationSnapshots.js';

const router = express.Router();

const SUPPORTED_SHARE_PROVIDERS = new Set(['claude', 'codex', 'openrouter', 'local']);

function normalizeProvider(provider) {
  const normalized = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  return SUPPORTED_SHARE_PROVIDERS.has(normalized) ? normalized : 'claude';
}

function normalizeVisibility(visibility) {
  return visibility === 'private' ? 'private' : 'public';
}

function getOptionalAuthenticatedUser(req) {
  try {
    if (IS_PLATFORM) {
      return userDb.getFirstUser() || null;
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    if (!token) {
      return null;
    }

    const decoded = verifyAccessToken(token);
    return userDb.getUserById(decoded.userId) || null;
  } catch (_) {
    return null;
  }
}

function buildShareUrl(req, token) {
  const configuredBaseUrl = process.env.PUBLIC_APP_URL || process.env.APP_URL || '';
  if (configuredBaseUrl) {
    return new URL(`/share/${encodeURIComponent(token)}`, configuredBaseUrl).toString();
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}/share/${encodeURIComponent(token)}`;
}

async function readRawConversationMessages(identity, provider) {
  const result = await runtimeSessionStoreRegistry.require(identity.runtimeId).read(identity, {
    provider,
    limit: null,
    offset: 0,
  });
  if (Array.isArray(result)) {
    return result;
  }
  return Array.isArray(result?.messages) ? result.messages : [];
}

function resolveShareTitle({ requestedTitle, session, visibleMessages }) {
  const title = typeof requestedTitle === 'string' ? requestedTitle.trim() : '';
  if (title) {
    return title.slice(0, 160);
  }

  const sessionTitle = session?.display_name || session?.summary || session?.name || '';
  if (typeof sessionTitle === 'string' && sessionTitle.trim()) {
    return sessionTitle.trim().slice(0, 160);
  }

  const firstUserMessage = visibleMessages.find((message) => message.role === 'user');
  const generatedTitle = buildSessionDisplayName(firstUserMessage?.content || '', 120);
  return generatedTitle || 'Shared conversation';
}

function isShareExpired(share) {
  if (!share?.expiresAt) {
    return false;
  }

  const expiry = new Date(share.expiresAt).getTime();
  return Number.isFinite(expiry) && expiry <= Date.now();
}

function serializeShareForViewer(share, req) {
  const snapshot = share.snapshot && typeof share.snapshot === 'object' ? share.snapshot : {};
  const visibleMessages = buildVisibleConversationMessages(
    Array.isArray(snapshot.messages) ? snapshot.messages : [],
  );
  return {
    token: share.token,
    visibility: share.visibility,
    title: share.title || snapshot.title || 'Shared conversation',
    project: snapshot.project || {
      name: share.projectName,
      displayName: share.projectName,
    },
    session: snapshot.session || {
      id: share.sessionId,
      provider: share.provider,
    },
    messages: visibleMessages,
    messageCount: visibleMessages.length,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    url: buildShareUrl(req, share.token),
  };
}

router.post('/snapshots', authenticateToken, async (req, res) => {
  try {
    const projectName = typeof req.body?.projectName === 'string' ? req.body.projectName.trim() : '';
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    const provider = normalizeProvider(req.body?.provider);
    const visibility = normalizeVisibility(req.body?.visibility);

    if (!projectName || !sessionId) {
      return res.status(400).json({ error: 'projectName and sessionId are required' });
    }

    const singleMessageContent = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const safeSingleMessageContent = (
      isCodexInternalPromptContent(singleMessageContent)
      || isSkillInstructionContent(singleMessageContent)
    )
      ? ''
      : singleMessageContent;
    const visibleMessages = safeSingleMessageContent
      ? [{
        role: req.body?.role === 'user' ? 'user' : 'assistant',
        content: req.body?.role === 'user'
          ? normalizeVisibleUserText(safeSingleMessageContent)
          : safeSingleMessageContent,
        timestamp: normalizeTimestamp(req.body?.timestamp),
      }]
      : Array.isArray(req.body?.messages)
        ? req.body.messages
        .filter((message) => message && typeof message === 'object')
        .map((message) => {
          const role = message.role === 'user' ? 'user' : 'assistant';
          const rawContent = typeof message.content === 'string' ? message.content.trim() : '';
          return {
            role,
            content: isSkillInstructionContent(rawContent)
              ? ''
              : role === 'user'
              ? normalizeVisibleUserText(rawContent)
              : isCodexInternalPromptContent(rawContent) ? '' : rawContent,
            timestamp: normalizeTimestamp(message.timestamp),
          };
        })
        .filter((message) => message.content)
        : buildVisibleConversationMessages(Array.isArray(req.body?.rawMessages) ? req.body.rawMessages : []);

    if (visibleMessages.length === 0) {
      return res.status(400).json({ error: 'No visible messages found for this session' });
    }

    const title = resolveShareTitle({
      requestedTitle: req.body?.title,
      session: {
        id: sessionId,
        provider,
        summary: req.body?.sessionTitle,
        name: req.body?.sessionTitle,
      },
      visibleMessages,
    });
    const projectDisplayName = typeof req.body?.projectDisplayName === 'string' && req.body.projectDisplayName.trim()
      ? req.body.projectDisplayName.trim()
      : projectName;
    const snapshot = {
      version: 1,
      title,
      project: {
        name: projectName,
        displayName: projectDisplayName,
      },
      session: {
        id: sessionId,
        provider,
      },
      messages: visibleMessages,
    };

    const expiresAt = req.body?.expiresAt && !Number.isNaN(new Date(req.body.expiresAt).getTime())
      ? new Date(req.body.expiresAt).toISOString()
      : null;

    const share = conversationShareDb.create({
      userId: req.user.id,
      projectName,
      sessionId,
      provider,
      visibility,
      title,
      snapshot,
      messageCount: visibleMessages.length,
      expiresAt,
    });

    res.status(201).json({
      share: serializeShareForViewer(share, req),
      url: buildShareUrl(req, share.token),
    });
  } catch (error) {
    console.error('Error creating conversation snapshot share:', error);
    res.status(500).json({ error: error.message || 'Failed to create conversation share' });
  }
});

router.post('/conversations', authenticateToken, async (req, res) => {
  try {
    const projectName = typeof req.body?.projectName === 'string' ? req.body.projectName.trim() : '';
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    const requestedProvider = typeof req.body?.provider === 'string' ? req.body.provider.trim().toLowerCase() : '';
    const visibility = normalizeVisibility(req.body?.visibility);

    if (!projectName || !sessionId) {
      return res.status(400).json({ error: 'projectName and sessionId are required' });
    }

    const project = projectDb.getProjectById(projectName);
    if (!project || (project.user_id && Number(project.user_id) !== Number(req.user.id))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const indexedSession = sessionDb.getSessionById(sessionId, {
      projectName,
      ...(requestedProvider ? { provider: requestedProvider } : {}),
      ownerKey: String(req.user.id),
    });
    if (indexedSession?.project_name && indexedSession.project_name !== projectName) {
      return res.status(404).json({ error: 'Session not found in this project' });
    }

    const provider = normalizeProvider(requestedProvider || indexedSession?.provider);
    const identity = createAgentSessionIdentity({
      ownerKey: indexedSession?.ownerKey || String(req.user.id),
      projectKey: indexedSession?.projectKey || projectName,
      runtimeId: indexedSession?.runtimeId || (provider === 'codex' ? 'codex' : 'claude'),
      sessionId,
    });
    const rawMessages = await readRawConversationMessages(identity, provider);
    const messages = buildVisibleConversationMessages(rawMessages);
    if (messages.length === 0) {
      return res.status(400).json({ error: 'No visible messages found for this session' });
    }

    const title = resolveShareTitle({
      requestedTitle: req.body?.title,
      session: indexedSession,
      visibleMessages: messages,
    });
    const snapshot = {
      version: 1,
      title,
      project: {
        name: projectName,
        displayName: project.display_name || projectName,
      },
      session: {
        id: sessionId,
        provider,
      },
      messages,
    };

    const expiresAt = req.body?.expiresAt && !Number.isNaN(new Date(req.body.expiresAt).getTime())
      ? new Date(req.body.expiresAt).toISOString()
      : null;

    const share = conversationShareDb.create({
      userId: req.user.id,
      projectName,
      sessionId,
      provider,
      visibility,
      title,
      snapshot,
      messageCount: messages.length,
      expiresAt,
    });

    res.status(201).json({
      share: serializeShareForViewer(share, req),
      url: buildShareUrl(req, share.token),
    });
  } catch (error) {
    console.error('Error creating conversation share:', error);
    res.status(500).json({ error: error.message || 'Failed to create conversation share' });
  }
});

router.post('/messages', authenticateToken, async (req, res) => {
  try {
    const projectName = typeof req.body?.projectName === 'string' ? req.body.projectName.trim() : '';
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    const requestedProvider = typeof req.body?.provider === 'string' ? req.body.provider.trim().toLowerCase() : '';
    const visibility = normalizeVisibility(req.body?.visibility);
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

    if (!projectName || !sessionId || !content) {
      return res.status(400).json({ error: 'projectName, sessionId, and content are required' });
    }
    if (isCodexInternalPromptContent(content) || isSkillInstructionContent(content)) {
      return res.status(400).json({ error: 'Internal prompt or skill content cannot be shared' });
    }

    const project = projectDb.getProjectById(projectName);
    if (!project || (project.user_id && Number(project.user_id) !== Number(req.user.id))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const indexedSession = sessionDb.getSessionById(sessionId, {
      projectName,
      ...(requestedProvider ? { provider: requestedProvider } : {}),
      ownerKey: String(req.user.id),
    });
    if (indexedSession?.project_name && indexedSession.project_name !== projectName) {
      return res.status(404).json({ error: 'Session not found in this project' });
    }

    const provider = normalizeProvider(requestedProvider || indexedSession?.provider);
    const title = resolveShareTitle({
      requestedTitle: req.body?.title || 'MedHelp shared answer',
      session: indexedSession,
      visibleMessages: [{ role: 'assistant', content }],
    });
    const messages = [{
      role: 'assistant',
      content,
      timestamp: normalizeTimestamp(req.body?.timestamp),
    }];
    const snapshot = {
      version: 1,
      shareType: 'message',
      title,
      project: {
        name: projectName,
        displayName: project.display_name || projectName,
      },
      session: {
        id: sessionId,
        provider,
      },
      messages,
    };

    const expiresAt = req.body?.expiresAt && !Number.isNaN(new Date(req.body.expiresAt).getTime())
      ? new Date(req.body.expiresAt).toISOString()
      : null;

    const share = conversationShareDb.create({
      userId: req.user.id,
      projectName,
      sessionId,
      provider,
      visibility,
      title,
      snapshot,
      messageCount: messages.length,
      expiresAt,
    });

    res.status(201).json({
      share: serializeShareForViewer(share, req),
      url: buildShareUrl(req, share.token),
    });
  } catch (error) {
    console.error('Error creating message share:', error);
    res.status(500).json({ error: error.message || 'Failed to create message share' });
  }
});

router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const projectName = typeof req.query?.projectName === 'string' ? req.query.projectName.trim() : '';
    const sessionId = typeof req.query?.sessionId === 'string' ? req.query.sessionId.trim() : '';
    const provider = typeof req.query?.provider === 'string' ? req.query.provider.trim().toLowerCase() : '';
    if (!projectName || !sessionId) {
      return res.status(400).json({ error: 'projectName and sessionId are required' });
    }

    const shares = conversationShareDb
      .listForSession(req.user.id, projectName, sessionId, provider ? { provider } : {})
      .map((share) => serializeShareForViewer(share, req));
    res.json({ shares });
  } catch (error) {
    console.error('Error listing conversation shares:', error);
    res.status(500).json({ error: 'Failed to list conversation shares' });
  }
});

router.delete('/:token', authenticateToken, async (req, res) => {
  try {
    const token = typeof req.params?.token === 'string' ? req.params.token.trim() : '';
    if (!token) {
      return res.status(400).json({ error: 'Share token is required' });
    }

    const revoked = conversationShareDb.revoke(token, req.user.id);
    if (!revoked) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking conversation share:', error);
    res.status(500).json({ error: 'Failed to revoke conversation share' });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const token = typeof req.params?.token === 'string' ? req.params.token.trim() : '';
    if (!token) {
      return res.status(400).json({ error: 'Share token is required' });
    }

    const share = conversationShareDb.getByToken(token);
    if (!share || share.revokedAt) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    if (isShareExpired(share)) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    if (share.visibility === 'private') {
      const user = getOptionalAuthenticatedUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (Number(user.id) !== Number(share.userId)) {
        return res.status(403).json({ error: 'You do not have access to this share link' });
      }
    }

    conversationShareDb.markAccessed(token);
    res.json({ share: serializeShareForViewer(share, req) });
  } catch (error) {
    console.error('Error reading conversation share:', error);
    res.status(500).json({ error: 'Failed to read conversation share' });
  }
});

export default router;
