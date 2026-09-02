import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { appSettingsDb, projectDb, userDb } from '../database/db.js';
import { executeAgentTurn } from '../agent-runtime/index.js';
import { addProjectManually } from '../projects.js';

export const IM_CHANNEL_SETTINGS_KEY = 'im_channel_settings';

const IM_CHANNEL_SETTINGS_USER_KEY_PREFIX = `${IM_CHANNEL_SETTINGS_KEY}:user:`;
const DEFAULT_IM_AGENT = 'pi';
const DOMESTIC_CHANNELS = Object.freeze(['feishu', 'dingtalk', 'wecom', 'qq', 'weixin']);
const WEIXIN_REPLY_CHUNK_SIZE = 2000;
const WEIXIN_BUSY_REPLY = '上一条消息还在处理，请稍后再发。';
const WEIXIN_NEW_SESSION_REPLY = '已创建新会话。';
const WEIXIN_EMPTY_REPLY = '我收到消息了，但智能体没有返回可发送的文本。';
const IM_PROJECT_REQUIRED_REPLY = [
  '请先选择一个 MedHelp 项目，再开始聊天。',
  '发送 /projects 查看项目，/use 1 选择项目，/create 项目名 新建项目，/help 查看全部命令。',
].join('\n');
const IM_HELP_TEXT = [
  'MedHelp IM 命令：',
  '/projects - 查看可用项目',
  '/find 关键词 - 搜索项目',
  '/use 编号或项目名 - 选择当前对话的项目',
  '/project - 查看当前项目',
  '/create 项目名 - 在工作区中新建项目并选中',
  '/new - 在当前项目中新开一个智能体会话',
  '/help - 查看这段帮助',
  '',
  '普通文字统一发送给 Pi 智能体。为避免写错目录，未选项目前不会让 AI 自动猜项目。',
].join('\n');

const channelRuntimes = new Map();
let projectsUpdatedBroadcaster = null;

export function configureImChannelRuntime(options = {}) {
  projectsUpdatedBroadcaster = typeof options.broadcastProjectsUpdated === 'function'
    ? options.broadcastProjectsUpdated
    : null;
}

export function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUserId(userId) {
  const value = Number.parseInt(userId, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function userSettingsKey(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return IM_CHANNEL_SETTINGS_KEY;
  }
  return `${IM_CHANNEL_SETTINGS_USER_KEY_PREFIX}${normalizedUserId}`;
}

function maskValue(value) {
  const rawValue = trimString(value);
  if (!rawValue) return '';
  if (rawValue.length <= 8) return rawValue;
  return `${rawValue.slice(0, 4)}...${rawValue.slice(-4)}`;
}

function normalizeDefaultAgent(value) {
  // IM is intentionally Pi-only. Legacy Claude/Codex values are migrated on read.
  return DEFAULT_IM_AGENT;
}

export function normalizeImChannelSettings(rawSettings = {}) {
  const feishu = rawSettings?.feishu || {};
  const dingtalk = rawSettings?.dingtalk || {};
  const wecom = rawSettings?.wecom || {};
  const qq = rawSettings?.qq || {};
  const weixin = rawSettings?.weixin || {};

  return {
    defaultAgent: normalizeDefaultAgent(rawSettings?.defaultAgent),
    feishu: {
      enabled: feishu.enabled === true,
      appId: trimString(feishu.appId),
      appSecret: trimString(feishu.appSecret),
      connectionMode: 'stream',
      domainName: 'feishu',
    },
    dingtalk: {
      enabled: dingtalk.enabled === true,
      appId: trimString(dingtalk.appId),
      appSecret: trimString(dingtalk.appSecret),
    },
    wecom: {
      enabled: wecom.enabled === true,
      botId: trimString(wecom.botId),
      secret: trimString(wecom.secret),
    },
    qq: {
      enabled: qq.enabled === true,
      appId: trimString(qq.appId),
      appSecret: trimString(qq.appSecret),
    },
    weixin: {
      enabled: weixin.enabled === true,
      baseUrl: trimString(weixin.baseUrl),
      botToken: trimString(weixin.botToken),
      accountId: trimString(weixin.accountId),
      cursor: trimString(weixin.cursor),
    },
  };
}

function parseStoredSettings(rawValue, sourceLabel) {
  if (!rawValue) {
    return null;
  }
  try {
    return normalizeImChannelSettings(JSON.parse(rawValue));
  } catch (error) {
    console.warn(`Failed to parse ${sourceLabel} IM channel settings:`, error.message);
    return null;
  }
}

export function loadImChannelSettings(userId = null) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return parseStoredSettings(appSettingsDb.get(IM_CHANNEL_SETTINGS_KEY), 'global') || normalizeImChannelSettings();
  }

  const scopedValue = appSettingsDb.get(userSettingsKey(normalizedUserId));
  const scopedSettings = parseStoredSettings(scopedValue, `user ${normalizedUserId}`);
  if (scopedSettings) {
    return scopedSettings;
  }

  const legacyValue = appSettingsDb.get(IM_CHANNEL_SETTINGS_KEY);
  const legacySettings = parseStoredSettings(legacyValue, 'legacy global');
  if (legacySettings) {
    appSettingsDb.set(userSettingsKey(normalizedUserId), JSON.stringify(legacySettings));
    appSettingsDb.set(IM_CHANNEL_SETTINGS_KEY, '');
    console.log(`[IM] Migrated legacy global IM settings to user ${normalizedUserId}`);
    return legacySettings;
  }

  return normalizeImChannelSettings();
}

export function saveImChannelSettings(userId, settings) {
  const normalized = normalizeImChannelSettings(settings);
  appSettingsDb.set(userSettingsKey(userId), JSON.stringify(normalized));
  return normalized;
}

export function buildImChannelStatus(userId, settings = loadImChannelSettings(userId)) {
  return {
    defaultAgent: DEFAULT_IM_AGENT,
    feishu: {
      enabled: settings.feishu.enabled,
      appId: maskValue(settings.feishu.appId),
      hasSecret: Boolean(settings.feishu.appSecret),
      connectionMode: settings.feishu.connectionMode,
      domainName: settings.feishu.domainName,
      runtime: getChannelRuntimeStatus(userId, 'feishu'),
    },
    dingtalk: {
      enabled: settings.dingtalk.enabled,
      appId: maskValue(settings.dingtalk.appId),
      hasSecret: Boolean(settings.dingtalk.appSecret),
      runtime: getChannelRuntimeStatus(userId, 'dingtalk'),
    },
    wecom: {
      enabled: settings.wecom.enabled,
      botId: maskValue(settings.wecom.botId),
      hasSecret: Boolean(settings.wecom.secret),
      runtime: getChannelRuntimeStatus(userId, 'wecom'),
    },
    qq: {
      enabled: settings.qq.enabled,
      appId: maskValue(settings.qq.appId),
      hasSecret: Boolean(settings.qq.appSecret),
      runtime: getChannelRuntimeStatus(userId, 'qq'),
    },
    weixin: {
      enabled: settings.weixin.enabled,
      hasCredentials: Boolean(settings.weixin.baseUrl && settings.weixin.botToken),
      accountId: maskValue(settings.weixin.accountId),
      baseUrl: maskValue(settings.weixin.baseUrl),
      runtime: getChannelRuntimeStatus(userId, 'weixin'),
    },
  };
}

function channelRuntimeKey(userId, platform) {
  return `${normalizeUserId(userId) || 'unknown'}:${platform}`;
}

function getChannelRuntimeStatus(userId, platform) {
  const normalizedUserId = normalizeUserId(userId);
  const runtime = normalizedUserId
    ? channelRuntimes.get(channelRuntimeKey(normalizedUserId, platform))
    : null;
  if (!runtime) {
    return { running: false, lastError: null, lastStartedAt: null };
  }
  return {
    running: runtime.running === true,
    lastError: runtime.lastError || null,
    lastStartedAt: runtime.startedAt || null,
  };
}

function getWeixinFingerprint(settings) {
  return `${settings.weixin.baseUrl}\n${settings.weixin.botToken}`;
}

function getChannelFingerprint(platform, settings) {
  if (platform === 'feishu') return `${settings.feishu.appId}\n${settings.feishu.appSecret}`;
  if (platform === 'dingtalk') return `${settings.dingtalk.appId}\n${settings.dingtalk.appSecret}`;
  if (platform === 'wecom') return `${settings.wecom.botId}\n${settings.wecom.secret}`;
  if (platform === 'qq') return `${settings.qq.appId}\n${settings.qq.appSecret}`;
  return getWeixinFingerprint(settings);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProjectRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: trimString(row.display_name) || row.id,
    path: trimString(row.path),
    lastAccessed: row.last_accessed || null,
    isStarred: row.is_starred === 1 || row.is_starred === true,
    metadata: row.metadata || null,
  };
}

function listUserProjects(userId) {
  return projectDb.getAllProjects(userId)
    .map(normalizeProjectRow)
    .filter((project) => (
      project
      && project.path
      && !project.metadata?.trash?.trashedAt
    ))
    .sort((left, right) => {
      if (left.isStarred !== right.isStarred) {
        return left.isStarred ? -1 : 1;
      }
      return String(right.lastAccessed || '').localeCompare(String(left.lastAccessed || ''))
        || left.displayName.localeCompare(right.displayName);
    });
}

function formatProjectList(projects, emptyText = '当前账号还没有项目。') {
  if (!projects.length) {
    return `${emptyText}\n发送 /create 项目名 可以新建一个项目。`;
  }

  const lines = projects.slice(0, 12).map((project, index) => (
    `${index + 1}. ${project.displayName}\n   ${project.path}`
  ));
  if (projects.length > 12) {
    lines.push(`还有 ${projects.length - 12} 个项目。发送 /find 关键词 缩小范围。`);
  }
  lines.push('发送 /use 编号或项目名 选择项目。');
  return lines.join('\n');
}

function resolveProjectReference(runtime, chatId, rawRef) {
  const ref = trimString(rawRef);
  if (!ref) return null;

  const cachedList = runtime.lastProjectLists.get(chatId) || [];
  const numericIndex = Number.parseInt(ref, 10);
  if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= cachedList.length) {
    return cachedList[numericIndex - 1];
  }

  const normalizedRef = ref.toLowerCase();
  const allProjects = listUserProjects(runtime.userId);
  return allProjects.find((project) => (
    project.id.toLowerCase() === normalizedRef
    || project.displayName.toLowerCase() === normalizedRef
    || project.path.toLowerCase() === normalizedRef
  )) || allProjects.find((project) => (
    project.displayName.toLowerCase().includes(normalizedRef)
    || project.id.toLowerCase().includes(normalizedRef)
    || project.path.toLowerCase().includes(normalizedRef)
  )) || null;
}

function sanitizeProjectFolderName(name) {
  return trimString(name)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 80)
    || `im-project-${Date.now()}`;
}

async function getImWorkspaceRoot(userId) {
  const user = typeof userDb.getWorkspaceRootUser === 'function'
    ? userDb.getWorkspaceRootUser(userId)
    : null;
  return trimString(user?.workspace_root)
    || trimString(process.env.WORKSPACES_ROOT)
    || os.homedir();
}

async function createProjectFromIm(runtime, chatId, rawName) {
  const displayName = trimString(rawName);
  if (!displayName) {
    return '请提供项目名，例如：/create HCC 免疫分析';
  }

  const root = await getImWorkspaceRoot(runtime.userId);
  await fs.mkdir(root, { recursive: true });

  const baseName = sanitizeProjectFolderName(displayName);
  let projectPath = path.join(root, baseName);
  for (let suffix = 2; suffix <= 100; suffix += 1) {
    try {
      await fs.access(projectPath);
      projectPath = path.join(root, `${baseName}-${suffix}`);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }

  await fs.mkdir(projectPath, { recursive: true });
  const project = await addProjectManually(projectPath, displayName, runtime.userId);
  const selected = normalizeProjectRow({
    id: project.name,
    display_name: project.displayName || displayName,
    path: project.fullPath || projectPath,
    is_starred: 0,
    last_accessed: new Date().toISOString(),
    metadata: null,
  });
  runtime.selectedProjectsByChat.set(chatId, selected);
  runtime.sessionsByChat.delete(chatId);
  if (projectsUpdatedBroadcaster) {
    await projectsUpdatedBroadcaster(runtime.userId, {
      changeType: 'im-project-created',
      projectName: selected.id,
      projectPath: selected.path,
    }).catch((error) => {
      console.warn(`[IM] Failed to broadcast project update for user ${runtime.userId}:`, error.message);
    });
  }

  return `已创建并选中项目：${selected.displayName}\n${selected.path}\n现在可以直接发消息聊天；发送 /new 可新开会话。`;
}

async function handleImControlCommand(runtime, chatId, text) {
  const trimmed = trimString(text);
  const lower = trimmed.toLowerCase();

  if (lower === '/help' || lower === 'help' || lower === '帮助') {
    return IM_HELP_TEXT;
  }

  if (lower === '/projects' || lower === 'projects' || lower === '项目') {
    const projects = listUserProjects(runtime.userId);
    runtime.lastProjectLists.set(chatId, projects);
    return formatProjectList(projects);
  }

  if (lower.startsWith('/find ')) {
    const query = lower.slice('/find '.length).trim();
    const projects = listUserProjects(runtime.userId).filter((project) => (
      project.displayName.toLowerCase().includes(query)
      || project.id.toLowerCase().includes(query)
      || project.path.toLowerCase().includes(query)
    ));
    runtime.lastProjectLists.set(chatId, projects);
    return formatProjectList(projects, `没有找到包含「${trimmed.slice('/find '.length).trim()}」的项目。`);
  }

  if (lower === '/project' || lower === 'project') {
    const currentProject = runtime.selectedProjectsByChat.get(chatId);
    if (!currentProject) {
      return IM_PROJECT_REQUIRED_REPLY;
    }
    return `当前项目：${currentProject.displayName}\n${currentProject.path}`;
  }

  if (lower.startsWith('/use ')) {
    const project = resolveProjectReference(runtime, chatId, trimmed.slice('/use '.length));
    if (!project) {
      return '没有找到这个项目。发送 /projects 查看列表，或 /find 关键词 搜索。';
    }
    runtime.selectedProjectsByChat.set(chatId, project);
    runtime.sessionsByChat.delete(chatId);
    return `已切换到项目：${project.displayName}\n${project.path}\n现在可以直接发消息聊天；发送 /new 可新开会话。`;
  }

  const selectPrefixes = ['/select ', '/进入 ', '进入项目 ', '选择项目 '];
  const selectPrefix = selectPrefixes.find((prefix) => lower.startsWith(prefix));
  if (selectPrefix) {
    const project = resolveProjectReference(runtime, chatId, trimmed.slice(selectPrefix.length));
    if (!project) {
      return '没有找到这个项目。发送 /projects 查看列表，或 /find 关键词 搜索。';
    }
    runtime.selectedProjectsByChat.set(chatId, project);
    runtime.sessionsByChat.delete(chatId);
    return `已切换到项目：${project.displayName}\n${project.path}\n现在可以直接发消息聊天；发送 /new 可新开会话。`;
  }

  if (lower.startsWith('/create ')) {
    return createProjectFromIm(runtime, chatId, trimmed.slice('/create '.length));
  }

  if (lower.startsWith('/new-project ')) {
    return createProjectFromIm(runtime, chatId, trimmed.slice('/new-project '.length));
  }

  const createPrefixes = ['新建项目 ', '创建项目 ', '新建一个项目 ', '创建一个项目 '];
  const createPrefix = createPrefixes.find((prefix) => trimmed.startsWith(prefix));
  if (createPrefix) {
    return createProjectFromIm(runtime, chatId, trimmed.slice(createPrefix.length));
  }

  if (lower === '/clear-project') {
    runtime.selectedProjectsByChat.delete(chatId);
    runtime.sessionsByChat.delete(chatId);
    return '已清除当前项目选择。发送 /projects 重新选择项目。';
  }

  return null;
}

function resolveImSession(runtime, chatId, text) {
  const trimmed = trimString(text);
  if (trimmed === '/new' || trimmed.startsWith('/new ')) {
    const sessionKey = `${runtime.platform}:user=${runtime.userId}:chat=${chatId}:s_${randomUUID()}`;
    runtime.sessionsByChat.set(chatId, sessionKey);
    return {
      sessionKey,
      command: 'new',
      message: trimmed.slice('/new'.length).trim(),
    };
  }

  return {
    sessionKey: runtime.sessionsByChat.get(chatId)
      || `${runtime.platform}:user=${runtime.userId}:chat=${chatId}:general`,
    message: trimmed,
  };
}

function extractTextFromWeixinMessage(msg, MessageItemType) {
  const textItem = (msg.item_list || []).find((item) => item?.type === MessageItemType.TEXT);
  return trimString(textItem?.text_item?.text);
}

function appendUnique(parts, text) {
  const value = typeof text === 'string' ? text : '';
  if (!value.trim()) return;
  if (parts.includes(value)) return;
  parts.push(value);
}

class ImAgentWriter {
  constructor() {
    this.provider = DEFAULT_IM_AGENT;
    this.isWebSocketWriter = true;
    this.parts = [];
    this.errors = [];
    this.sessionId = null;
  }

  setSessionId(sessionId) {
    if (sessionId) {
      this.sessionId = sessionId;
    }
  }

  send(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.type === 'session-created' && payload.sessionId) {
      this.setSessionId(payload.sessionId);
      return;
    }

    if (payload.type === 'pi-response') {
      const data = payload.data;
      if (data?.event === 'text_delta' && typeof data?.data?.text === 'string') {
        this.parts.push(data.data.text);
      } else if (data?.event === 'assistant_message_end') {
        appendUnique(this.parts, data?.data?.text || data?.data?.content);
      }
      if (payload.sessionId) {
        this.setSessionId(payload.sessionId);
      }
      return;
    }

    if (payload.type === 'pi-error') {
      if (payload.error) {
        this.errors.push(String(payload.error));
      }
      if (payload.sessionId) {
        this.setSessionId(payload.sessionId);
      }
    }
  }

  text() {
    return this.parts.join('').trim();
  }
}

async function runImAgentTurn({ message, sessionKey, userId, projectPath = null, projectKey = null }) {
  const writer = new ImAgentWriter();
  const sessionCacheKey = `${DEFAULT_IM_AGENT}:${sessionKey}`;
  const runtimeSessionIds = runImAgentTurn.sessionIds || new Map();
  runImAgentTurn.sessionIds = runtimeSessionIds;
  const workingDirectory = trimString(projectPath);

  const existingSessionId = runtimeSessionIds.get(sessionCacheKey) || null;
  const requestedSessionId = existingSessionId || `new-session-im-${randomUUID()}`;
  await executeAgentTurn({
    identity: {
      ownerKey: String(userId),
      projectKey: trimString(projectKey) || workingDirectory || 'im',
      runtimeId: DEFAULT_IM_AGENT,
      sessionId: requestedSessionId,
    },
    runtimeId: DEFAULT_IM_AGENT,
    command: message,
    resume: Boolean(existingSessionId),
    options: {
      cwd: workingDirectory || process.cwd(),
      projectPath: workingDirectory || process.cwd(),
      ...(existingSessionId ? { sessionId: existingSessionId } : {}),
      permissionMode: 'auto',
      userId,
      onLifecycleEvent: (event = {}) => {
        if (event.sessionId) writer.setSessionId(event.sessionId);
      },
    },
  }, writer);

  if (writer.sessionId) {
    runtimeSessionIds.set(sessionCacheKey, writer.sessionId);
  }

  const text = writer.text();
  if (text) {
    return text;
  }
  if (writer.errors.length > 0) {
    return `智能体返回错误：${writer.errors[writer.errors.length - 1]}`;
  }
  return WEIXIN_EMPTY_REPLY;
}

async function sendWeixinReply(runtime, userId, text) {
  const contextToken = runtime.contextTokens.get(userId);
  if (!runtime.client || !contextToken) {
    console.warn(`[IM] WeChat reply skipped for user ${runtime.userId}: missing client/context token`);
    return;
  }
  await runtime.client.sendTextChunked(userId, text || WEIXIN_EMPTY_REPLY, contextToken, WEIXIN_REPLY_CHUNK_SIZE);
}

async function dispatchImText(runtime, { chatId, text, sendReply, sendTyping = null }) {
  const normalizedChatId = trimString(chatId);
  const normalizedText = trimString(text);
  if (!normalizedChatId || !normalizedText) return;

  const reply = async (value) => sendReply(value || WEIXIN_EMPTY_REPLY);
  const commandReply = await handleImControlCommand(runtime, normalizedChatId, normalizedText);
  if (commandReply) {
    await reply(commandReply).catch(() => null);
    return;
  }

  if (runtime.activeChats.has(normalizedChatId)) {
    await reply(WEIXIN_BUSY_REPLY).catch(() => null);
    return;
  }

  const selectedProject = runtime.selectedProjectsByChat.get(normalizedChatId);
  if (!selectedProject?.path) {
    await reply(IM_PROJECT_REQUIRED_REPLY).catch(() => null);
    return;
  }

  const mapped = resolveImSession(runtime, normalizedChatId, normalizedText);
  if (mapped.command === 'new' && !mapped.message) {
    await reply(WEIXIN_NEW_SESSION_REPLY).catch(() => null);
    return;
  }

  runtime.activeChats.add(normalizedChatId);
  try {
    if (typeof sendTyping === 'function') await sendTyping().catch(() => null);
    const result = await runImAgentTurn({
      message: mapped.message,
      sessionKey: `${mapped.sessionKey}:project=${selectedProject.id}`,
      userId: runtime.userId,
      projectPath: selectedProject.path,
      projectKey: selectedProject.id,
    });
    await reply(result);
  } catch (error) {
    runtime.lastError = error.message || String(error);
    console.error(`[IM] ${runtime.platform} dispatch failed for user ${runtime.userId}:`, runtime.lastError);
    await reply(`处理消息失败：${runtime.lastError}`).catch(() => null);
  } finally {
    runtime.activeChats.delete(normalizedChatId);
  }
}

async function dispatchWeixinMessage(runtime, msg, MessageItemType) {
  const fromUser = trimString(msg.from_user_id);
  if (!fromUser) return;

  if (msg.context_token) {
    runtime.contextTokens.set(fromUser, msg.context_token);
  }

  const text = extractTextFromWeixinMessage(msg, MessageItemType);
  if (!text) return;

  await dispatchImText(runtime, {
    chatId: fromUser,
    text,
    sendReply: (replyText) => sendWeixinReply(runtime, fromUser, replyText),
    sendTyping: () => runtime.client?.sendTyping(
      fromUser,
      runtime.contextTokens.get(fromUser),
    ),
  });
}

async function persistWeixinCursor(runtime) {
  if (!runtime.client?.cursor) return;
  const settings = loadImChannelSettings(runtime.userId);
  if (settings.weixin.cursor === runtime.client.cursor) return;
  settings.weixin.cursor = runtime.client.cursor;
  saveImChannelSettings(runtime.userId, settings);
}

async function pollWeixinLoop(runtime, MessageItemType) {
  while (!runtime.abortController.signal.aborted) {
    try {
      const response = await runtime.client.poll();
      if (runtime.abortController.signal.aborted) {
        break;
      }

      if (response.errcode === -14) {
        runtime.lastError = '微信登录已过期，请重新扫码绑定。';
        console.warn(`[IM] WeChat session expired for user ${runtime.userId}`);
        break;
      }

      if (response.ret !== 0 && response.ret !== undefined) {
        runtime.lastError = response.errmsg || `WeChat poll ret=${response.ret}`;
        await sleep(3000);
        continue;
      }

      runtime.lastError = null;
      for (const msg of response.msgs || []) {
        if (msg?.message_type === 1) {
          void dispatchWeixinMessage(runtime, msg, MessageItemType);
        }
      }

      await persistWeixinCursor(runtime);
    } catch (error) {
      if (runtime.abortController.signal.aborted) {
        break;
      }
      runtime.lastError = error.message || String(error);
      console.error(`[IM] WeChat poll error for user ${runtime.userId}:`, runtime.lastError);
      await sleep(3000);
    }
  }

  runtime.running = false;
  await persistWeixinCursor(runtime).catch(() => null);
  const key = channelRuntimeKey(runtime.userId, 'weixin');
  if (channelRuntimes.get(key) === runtime) {
    channelRuntimes.delete(key);
  }
}

export async function ensureWeixinRuntime(userId, settings = loadImChannelSettings(userId)) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  if (!settings.weixin.enabled || !settings.weixin.baseUrl || !settings.weixin.botToken) {
    await stopWeixinRuntime(normalizedUserId);
    return null;
  }

  const fingerprint = getWeixinFingerprint(settings);
  const key = channelRuntimeKey(normalizedUserId, 'weixin');
  const existing = channelRuntimes.get(key);
  if (existing?.running && existing.fingerprint === fingerprint) {
    return existing;
  }

  await stopWeixinRuntime(normalizedUserId);

  const { ILinkClient, MessageItemType } = await import('weixin-ilink');
  const client = new ILinkClient({
    baseUrl: settings.weixin.baseUrl,
    token: settings.weixin.botToken,
  });
  if (settings.weixin.cursor) {
    client.cursor = settings.weixin.cursor;
  }

  const runtime = {
    userId: normalizedUserId,
    platform: 'weixin',
    client,
    abortController: new AbortController(),
    pollPromise: null,
    fingerprint,
    activeChats: new Set(),
    contextTokens: new Map(),
    sessionsByChat: new Map(),
    selectedProjectsByChat: new Map(),
    lastProjectLists: new Map(),
    running: true,
    startedAt: new Date().toISOString(),
    lastError: null,
  };

  runtime.pollPromise = pollWeixinLoop(runtime, MessageItemType).catch((error) => {
    runtime.running = false;
    runtime.lastError = error.message || String(error);
    console.error(`[IM] WeChat runtime crashed for user ${normalizedUserId}:`, runtime.lastError);
  });
  channelRuntimes.set(key, runtime);
  console.log(`[IM] WeChat runtime started for user ${normalizedUserId}`);
  return runtime;
}

export async function stopWeixinRuntime(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;

  const key = channelRuntimeKey(normalizedUserId, 'weixin');
  const runtime = channelRuntimes.get(key);
  if (!runtime) return;

  channelRuntimes.delete(key);
  runtime.abortController.abort();
  runtime.running = false;
  await persistWeixinCursor(runtime).catch(() => null);
}

function createChannelRuntimeState(userId, platform, fingerprint) {
  return {
    userId,
    platform,
    fingerprint,
    activeChats: new Set(),
    sessionsByChat: new Map(),
    selectedProjectsByChat: new Map(),
    lastProjectLists: new Map(),
    running: true,
    startedAt: new Date().toISOString(),
    lastError: null,
    stop: async () => {},
  };
}

function splitReply(text, size = 4000) {
  const value = trimString(text) || WEIXIN_EMPTY_REPLY;
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += size) {
    chunks.push(value.slice(offset, offset + size));
  }
  return chunks.length ? chunks : [WEIXIN_EMPTY_REPLY];
}

async function startFeishuRuntime(runtime, config) {
  const lark = await import('@larksuiteoapi/node-sdk');
  const channel = lark.createLarkChannel({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    domain: lark.Domain.Feishu,
    source: 'medhelp',
    handshakeTimeoutMs: 20_000,
  });
  channel.on('message', async (message = {}) => {
    if (message.chatType === 'group' && !message.mentionedBot) return;
    const text = trimString(message.content)
      .replace(/!\[image\]\([^)]*\)/g, '')
      .replace(/<file key="[^"]*"\s*\/>/g, '')
      .trim();
    if (!text) return;
    await dispatchImText(runtime, {
      chatId: message.chatId,
      text,
      sendReply: async (replyText) => {
        for (const chunk of splitReply(replyText, 9000)) {
          await channel.send(message.chatId, { markdown: chunk });
        }
      },
    });
  });
  await channel.connect();
  runtime.stop = async () => channel.disconnect();
}

async function startDingtalkRuntime(runtime, config) {
  const sdk = await import('dingtalk-stream-sdk-nodejs');
  const client = new sdk.DWClient({
    clientId: config.appId,
    clientSecret: config.appSecret,
    ua: 'medhelp',
  });
  client.registerCallbackListener(sdk.TOPIC_ROBOT || '/v1.0/im/bot/messages/get', (frame) => {
    void (async () => {
      const message = JSON.parse(frame.data || '{}');
      const chatId = trimString(message.conversationId);
      const webhook = trimString(message.sessionWebhook);
      const text = trimString(message.text?.content);
      if (!chatId || !webhook || !text) return;
      await dispatchImText(runtime, {
        chatId,
        text,
        sendReply: async (replyText) => {
          for (const chunk of splitReply(replyText, 7000)) {
            const response = await fetch(webhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                msgtype: 'markdown',
                markdown: { title: 'Pi 回复', text: chunk },
              }),
              signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) throw new Error(`钉钉回复失败：HTTP ${response.status}`);
          }
        },
      });
    })().catch((error) => {
      runtime.lastError = error.message || String(error);
      console.error(`[IM] dingtalk callback failed for user ${runtime.userId}:`, runtime.lastError);
    });
  });
  await client.connect();
  runtime.stop = async () => client.disconnect();
}

async function startWecomRuntime(runtime, config) {
  const sdk = await import('@wecom/aibot-node-sdk');
  const client = new sdk.WSClient({ botId: config.botId, secret: config.secret });
  let sequence = 0;
  client.on('message', (frame = {}) => {
    void (async () => {
      const body = frame.body || {};
      const senderId = trimString(body.from?.userid);
      const chatId = body.chattype === 'group' ? trimString(body.chatid) : senderId;
      const text = trimString(body.text?.content || body.voice?.content);
      if (!chatId || !text) return;
      const streamId = `${frame.headers?.req_id || 'im'}-${sequence += 1}`;
      await client.replyStream(frame, streamId, '正在交给 Pi 处理…', false).catch(() => null);
      await dispatchImText(runtime, {
        chatId,
        text,
        sendReply: (replyText) => client.replyStream(frame, streamId, replyText, true),
      });
    })().catch((error) => {
      runtime.lastError = error.message || String(error);
      console.error(`[IM] wecom callback failed for user ${runtime.userId}:`, runtime.lastError);
    });
  });
  client.on('error', (error) => {
    runtime.lastError = error?.message || String(error || '企业微信连接错误');
  });
  client.connect();
  runtime.stop = async () => client.disconnect();
}

async function startQqRuntime(runtime, config) {
  const qq = await import('qq-official-bot');
  const bot = new qq.Bot({
    appid: config.appId,
    secret: config.appSecret,
    mode: 'websocket',
    intents: ['GROUP_AND_C2C_EVENT', 'PUBLIC_GUILD_MESSAGES', 'DIRECT_MESSAGE'],
    logLevel: 'warn',
    removeAt: true,
  });
  bot.on('message', (message = {}) => {
    void (async () => {
      const route = message.group_id
        ? { kind: 'group', chatId: message.group_id }
        : message.channel_id
          ? { kind: 'guild', chatId: message.channel_id }
          : { kind: 'private', chatId: message.sender?.user_id || message.user_id };
      const text = trimString(message.raw_message);
      if (!route.chatId || !text) return;
      const send = async (replyText) => {
        for (const chunk of splitReply(replyText, 1800)) {
          if (route.kind === 'group') await bot.sendGroupMessage(route.chatId, chunk, { id: message.id });
          else if (route.kind === 'guild') await bot.sendGuildMessage(route.chatId, chunk, { id: message.id });
          else await bot.sendPrivateMessage(route.chatId, chunk, { id: message.id });
        }
      };
      await send('正在交给 Pi 处理…').catch(() => null);
      await dispatchImText(runtime, { chatId: route.chatId, text, sendReply: send });
    })().catch((error) => {
      runtime.lastError = error.message || String(error);
      console.error(`[IM] qq callback failed for user ${runtime.userId}:`, runtime.lastError);
    });
  });
  await bot.start();
  runtime.stop = async () => bot.stop();
}

function channelConfig(platform, settings) {
  if (platform === 'feishu') return settings.feishu;
  if (platform === 'dingtalk') return settings.dingtalk;
  if (platform === 'wecom') return settings.wecom;
  if (platform === 'qq') return settings.qq;
  return settings.weixin;
}

function hasChannelCredentials(platform, config) {
  if (!config?.enabled) return false;
  if (platform === 'wecom') return Boolean(config.botId && config.secret);
  if (platform === 'weixin') return Boolean(config.baseUrl && config.botToken);
  return Boolean(config.appId && config.appSecret);
}

export async function stopDomesticChannelRuntime(userId, platform) {
  if (!DOMESTIC_CHANNELS.includes(platform)) return;
  if (platform === 'weixin') {
    await stopWeixinRuntime(userId);
    return;
  }
  const key = channelRuntimeKey(userId, platform);
  const runtime = channelRuntimes.get(key);
  if (!runtime) return;
  channelRuntimes.delete(key);
  runtime.running = false;
  await runtime.stop?.().catch(() => null);
}

export async function ensureDomesticChannelRuntime(
  userId,
  platform,
  settings = loadImChannelSettings(userId),
) {
  if (!DOMESTIC_CHANNELS.includes(platform)) {
    throw new Error(`Unsupported domestic IM channel: ${platform}`);
  }
  if (platform === 'weixin') return ensureWeixinRuntime(userId, settings);

  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  const config = channelConfig(platform, settings);
  if (!hasChannelCredentials(platform, config)) {
    await stopDomesticChannelRuntime(normalizedUserId, platform);
    return null;
  }

  const key = channelRuntimeKey(normalizedUserId, platform);
  const fingerprint = getChannelFingerprint(platform, settings);
  const existing = channelRuntimes.get(key);
  if (existing?.running && existing.fingerprint === fingerprint) return existing;
  await stopDomesticChannelRuntime(normalizedUserId, platform);

  const runtime = createChannelRuntimeState(normalizedUserId, platform, fingerprint);
  channelRuntimes.set(key, runtime);
  try {
    if (platform === 'feishu') await startFeishuRuntime(runtime, config);
    else if (platform === 'dingtalk') await startDingtalkRuntime(runtime, config);
    else if (platform === 'wecom') await startWecomRuntime(runtime, config);
    else if (platform === 'qq') await startQqRuntime(runtime, config);
    console.log(`[IM] ${platform} runtime started for user ${normalizedUserId}`);
    return runtime;
  } catch (error) {
    runtime.running = false;
    runtime.lastError = error.message || String(error);
    console.error(`[IM] Failed to start ${platform} for user ${normalizedUserId}:`, runtime.lastError);
    return runtime;
  }
}

export async function validateDomesticChannelCredentials(platform, credentials = {}) {
  if (platform === 'dingtalk') {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: trimString(credentials.appId), appSecret: trimString(credentials.appSecret) }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    return data.accessToken
      ? { ok: true }
      : { ok: false, error: data.message || `HTTP ${response.status}` };
  }
  if (platform === 'qq') {
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: trimString(credentials.appId), clientSecret: trimString(credentials.appSecret) }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    return data.access_token
      ? { ok: true }
      : { ok: false, error: data.message || `HTTP ${response.status}` };
  }
  if (platform === 'wecom') {
    const botId = trimString(credentials.botId);
    const secret = trimString(credentials.secret);
    if (!botId || !secret) return { ok: false, error: 'BotID and Secret are required' };
    const sdk = await import('@wecom/aibot-node-sdk');
    return new Promise((resolve) => {
      const client = new sdk.WSClient({
        botId,
        secret,
        maxReconnectAttempts: 0,
        maxAuthFailureAttempts: 0,
      });
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { client.disconnect(); } catch { /* Ignore cleanup failures. */ }
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ ok: false, error: '连接企业微信超时' }),
        12_000,
      );
      client.on('authenticated', () => finish({ ok: true }));
      client.on('error', (error) => finish({
        ok: false,
        error: error?.message || '企业微信拒绝了当前凭据',
      }));
      try {
        client.connect();
      } catch (error) {
        finish({ ok: false, error: error.message || String(error) });
      }
    });
  }
  return { ok: false, error: `Unsupported credential test: ${platform}` };
}

export async function startConfiguredImChannelRuntimes() {
  const users = typeof userDb.listAdminUsers === 'function' ? userDb.listAdminUsers() : [];
  for (const user of users) {
    const userId = normalizeUserId(user?.id);
    if (!userId) continue;
    const settings = loadImChannelSettings(userId);
    for (const platform of DOMESTIC_CHANNELS) {
      if (!hasChannelCredentials(platform, channelConfig(platform, settings))) continue;
      await ensureDomesticChannelRuntime(userId, platform, settings).catch((error) => {
        console.warn(`[IM] Failed to start ${platform} runtime for user ${userId}:`, error.message);
      });
    }
  }
}
