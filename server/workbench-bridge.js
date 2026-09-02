import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { IS_PLATFORM } from './constants/config.js';
import { userDb } from './database/db.js';
import { generateToken } from './middleware/auth.js';
import { createWorkbenchToolHandlers } from './workbench-mcp.js';
import { DEFAULT_BACKEND_PORT, getBackendPortSync } from './utils/runtimePorts.js';

export const WORKBENCH_MCP_SERVER_NAME = 'medhelp_workbench';
export const WORKBENCH_READ_TOOL_NAMES = Object.freeze([
  'overview', 'today_status', 'meeting_list', 'meeting_get', 'action_list', 'transcript_get', 'calendar_list', 'notes_list',
  'thesis_list', 'thesis_get', 'submission_list', 'submission_get', 'daily_review_get', 'habit_list',
]);
export const WORKBENCH_MUTATION_TOOL_NAMES = Object.freeze([
  'meeting_create', 'meeting_update', 'agenda_add', 'agenda_update', 'note_add',
  'note_promote', 'action_create', 'action_update', 'action_promote_task', 'transcript_update',
  'calendar_create', 'calendar_update',
  'thesis_create', 'thesis_update', 'thesis_chapter_add', 'thesis_chapter_update',
  'thesis_milestone_add', 'thesis_milestone_update', 'thesis_log_add',
  'submission_create', 'submission_update', 'daily_review_save',
  'attendance_start', 'attendance_end', 'focus_log', 'habit_create', 'habit_entry_update',
]);

const MCP_ENV_KEYS = Object.freeze({
  win32: [
    'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH',
    'PROCESSOR_ARCHITECTURE', 'PROGRAMFILES', 'SYSTEMDRIVE', 'SYSTEMROOT',
    'TEMP', 'USERNAME', 'USERPROFILE',
  ],
  default: ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER'],
});

function safeDateTime(value) {
  if (typeof value !== 'string' || !value) return '未安排';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 40);
  const pad = (part) => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function safeText(value, fallback = '未命名') {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return normalized ? normalized.slice(0, 180) : fallback;
}

export function buildWorkbenchContext(overview, { bridgeAvailable = true } = {}) {
  const lines = ['<medhelp_workbench_context>', '[MedHelp 科研工作台]'];
  if (!overview || typeof overview !== 'object') {
    lines.push('工作台数据暂不可用。');
  } else {
    const nextMeeting = overview.nextMeeting;
    lines.push(nextMeeting
      ? `下次组会：${safeDateTime(nextMeeting.meetingDate)}「${safeText(nextMeeting.title)}」（${nextMeeting.myRole === 'presenter' ? '我是汇报人' : '我是参会人'}）`
      : '下次组会：未安排');
    lines.push(`未完成 action：${Number(overview.openActionCount) || 0} 条，其中逾期 ${Number(overview.overdueActionCount) || 0} 条`);
    lines.push(`今日待办：${Number(overview.todayTodoCount) || 0} 条`);
    if (overview.todayStatus) {
      lines.push(`今日状态：工作 ${Number(overview.todayStatus.workMinutes) || 0} 分钟，专注 ${Number(overview.todayStatus.focusMinutes) || 0} 分钟，习惯 ${Number(overview.todayStatus.habitCompletion) || 0}%，${overview.todayStatus.reviewCompleted ? '已复盘' : '待复盘'}`);
    }
    lines.push(`毕业论文：${Number(overview.totals?.theses) || 0} 项；活跃投稿：${Number(overview.todayStatus?.activeSubmissionCount) || 0} 篇`);
    const latest = Array.isArray(overview.recentMeetings) ? overview.recentMeetings[0] : null;
    if (latest) {
      lines.push(`最近一次会议：${safeDateTime(latest.meetingDate)}「${safeText(latest.title)}」（${latest.status === 'done' ? '已完成' : safeText(latest.status, '状态未知')}）`);
    }
  }
  if (bridgeAvailable) {
    lines.push(
      '用 medhelp_workbench 工具读取与修改工作台数据，不要凭记忆回答工作台状态。',
      '写入类工具会向用户弹出确认；生成的纪要、待办一律作为草稿提交确认，不要在工具成功前声称已保存。',
    );
  } else {
    lines.push('工作台工具在当前安装中不可用；可以说明需要更新本地 Kernel，但不要尝试直接读写数据库。');
  }
  lines.push('</medhelp_workbench_context>');
  return lines.join('\n').slice(0, 1500);
}

export function prependWorkbenchContext(command, bridge) {
  const prompt = typeof bridge?.prompt === 'string' ? bridge.prompt.trim() : '';
  return prompt ? `${prompt}\n\n${command}` : command;
}

export function resolveWorkbenchMcpLauncher({
  env = process.env,
  platform = process.platform,
  nodeExecutable = process.execPath,
  moduleUrl = import.meta.url,
  existsSync = fs.existsSync,
} = {}) {
  const runtimeRoot = typeof env.MEDHELP_RUNTIME_ROOT === 'string'
    ? env.MEDHELP_RUNTIME_ROOT.trim()
    : '';
  if (runtimeRoot) {
    const command = path.join(runtimeRoot, 'bin', platform === 'win32' ? 'node.exe' : 'node');
    const script = path.join(runtimeRoot, 'workbench-mcp.cjs');
    return existsSync(command) && existsSync(script) ? { command, script } : null;
  }
  const script = fileURLToPath(new URL('./bin/workbench-mcp.js', moduleUrl));
  return existsSync(nodeExecutable) && existsSync(script) ? { command: nodeExecutable, script } : null;
}

export function buildWorkbenchMcpEnv({
  env = process.env,
  platform = process.platform,
  baseUrl,
  token = '',
  readOnly = false,
} = {}) {
  const serverEnv = {};
  const inheritedKeys = platform === 'win32' ? MCP_ENV_KEYS.win32 : MCP_ENV_KEYS.default;
  for (const key of inheritedKeys) {
    const value = typeof env[key] === 'string' ? env[key] : '';
    if (value && !value.startsWith('()')) serverEnv[key] = value;
  }
  serverEnv.MEDHELP_WORKBENCH_BASE_URL = baseUrl;
  if (token) serverEnv.MEDHELP_WORKBENCH_TOKEN = token;
  if (readOnly) serverEnv.MEDHELP_WORKBENCH_READ_ONLY = '1';
  return serverEnv;
}

export async function resolveWorkbenchBridge({
  userId = null,
  authSessionId = null,
  env = process.env,
  isPlatform = IS_PLATFORM,
  readOnly = false,
  loadUser = (id) => (id == null ? null : userDb.getUserById(id)),
  loadFirstUser = () => userDb.getFirstUser(),
  generateAccessToken = generateToken,
  resolvePort = () => getBackendPortSync(DEFAULT_BACKEND_PORT),
  resolveLauncher = resolveWorkbenchMcpLauncher,
  fetchImpl = globalThis.fetch,
  contextTimeoutMs = 2_000,
} = {}) {
  const user = isPlatform ? loadFirstUser() : loadUser(userId);
  if (!user || (!isPlatform && !authSessionId)) return null;

  const port = resolvePort();
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const baseUrl = `http://127.0.0.1:${port}/api/research`;
  const token = isPlatform ? '' : generateAccessToken(user, authSessionId);
  const launcher = resolveLauncher({ env });
  const serverEnv = buildWorkbenchMcpEnv({ env, baseUrl, token, readOnly });

  let overview = null;
  let contextDiagnostic = null;
  try {
    const handlers = createWorkbenchToolHandlers({
      baseUrl,
      token,
      fetchImpl,
      timeoutMs: contextTimeoutMs,
    });
    overview = (await handlers.overview()).structuredContent;
  } catch (error) {
    contextDiagnostic = {
      code: 'workbench_context_unavailable',
      message: error?.message || String(error),
    };
  }

  return {
    prompt: buildWorkbenchContext(overview, { bridgeAvailable: Boolean(launcher) }),
    mcpServer: launcher ? {
      command: launcher.command,
      args: [launcher.script],
      env: serverEnv,
    } : null,
    diagnostic: contextDiagnostic || (!launcher ? { code: 'workbench_bridge_unavailable' } : null),
  };
}
