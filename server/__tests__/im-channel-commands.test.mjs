import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import enSettings from '../../src/i18n/locales/en/settings.json' with { type: 'json' };
import zhSettings from '../../src/i18n/locales/zh-CN/settings.json' with { type: 'json' };

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;
const originalWorkspacesRoot = process.env.WORKSPACES_ROOT;
const originalDefaultConversationWorkspace = process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE;

const agentTurns = [];
const executeAgentTurn = vi.fn(async (request, writer) => {
  agentTurns.push(request);
  writer.send({
    type: 'pi-response',
    data: {
      event: 'assistant_message_end',
      data: { text: `agent:${request.command}` },
    },
  });
});

vi.mock('../agent-runtime/index.js', () => ({
  executeAgentTurn: (...args) => executeAgentTurn(...args),
}));

let tempRoot = null;
let database = null;
let imRuntime = null;

async function loadModules() {
  vi.resetModules();
  agentTurns.length = 0;
  executeAgentTurn.mockClear();
  const projects = await import('../projects.js');
  database = await import('../database/db.js');
  await database.initializeDatabase();
  imRuntime = await import('../services/im-channel-runtime.js');
  return { projects, database, imRuntime };
}

function createRuntime(userId) {
  return {
    userId,
    platform: 'feishu',
    activeChats: new Set(),
    sessionsByChat: new Map(),
    selectedProjectsByChat: new Map(),
    lastProjectLists: new Map(),
    lastError: null,
  };
}

async function dispatch(runtime, text, chatId = 'chat-1') {
  const replies = [];
  await imRuntime.dispatchImText(runtime, {
    chatId,
    text,
    sendReply: async (value) => {
      replies.push(value);
    },
  });
  return replies;
}

describe('IM channel project and conversation commands', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-im-commands-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
    process.env.WORKSPACES_ROOT = tempRoot;
    delete process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE;
    await mkdir(path.join(tempRoot, 'db'), { recursive: true });
  });

  afterEach(async () => {
    if (database?.db?.open) {
      database.db.close();
    }
    database = null;
    imRuntime = null;
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalWorkspacesRoot === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = originalWorkspacesRoot;
    if (originalDefaultConversationWorkspace === undefined) {
      delete process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE;
    } else {
      process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE = originalDefaultConversationWorkspace;
    }

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('documents /find and the default conversation workspace in help copy', () => {
    const zhCommands = zhSettings.imChannels.commandHelp.items.map((item) => item.command);
    const enCommands = enSettings.imChannels.commandHelp.items.map((item) => item.command);
    expect(zhCommands).toContain('/find 关键词');
    expect(enCommands).toContain('/find keyword');
    expect(zhSettings.imChannels.commandHelp.description).toContain('对话和任务');
    expect(enSettings.imChannels.commandHelp.description).toMatch(/Chats and tasks/i);
  });

  it('lets a chat start in 对话和任务 without /use, then allocates a conversation folder', async () => {
    const { database: db } = await loadModules();
    const user = db.userDb.createUser('im-owner', 'hash');
    db.userDb.updateWorkspaceRoot(user.id, tempRoot);
    const runtime = createRuntime(user.id);

    const help = await dispatch(runtime, '/help');
    expect(help[0]).toContain('/find');
    expect(help[0]).toContain('对话和任务');

    const listed = await dispatch(runtime, '/projects');
    expect(listed[0]).toMatch(/1\.\s*对话和任务/);

    const replies = await dispatch(runtime, '帮我列一下今天的待办');
    expect(replies).toEqual(['agent:帮我列一下今天的待办']);
    expect(agentTurns).toHaveLength(1);
    expect(agentTurns[0].options.cwd).toMatch(/conversation-\d{2}-\d{2}-\d{2}/);
    expect(agentTurns[0].options.cwd).not.toBe(tempRoot);

    const current = await dispatch(runtime, '/project');
    expect(current[0]).toContain('当前项目');
    expect(current[0]).not.toContain('请先选择一个 MedHelp 项目');
  });

  it('keeps /use on a research project and /new in chats isolated from each other', async () => {
    const { database: db, projects } = await loadModules();
    const user = db.userDb.createUser('im-researcher', 'hash');
    db.userDb.updateWorkspaceRoot(user.id, tempRoot);
    const researchPath = path.join(tempRoot, 'hcc-analysis');
    await mkdir(researchPath, { recursive: true });
    await projects.addProjectManually(researchPath, 'HCC 免疫分析', user.id);
    const runtime = createRuntime(user.id);

    await dispatch(runtime, '/projects');
    const switched = await dispatch(runtime, '/use HCC 免疫分析');
    expect(switched[0]).toContain('HCC 免疫分析');

    const researchReply = await dispatch(runtime, '总结这个项目');
    expect(researchReply).toEqual(['agent:总结这个项目']);
    expect(agentTurns[0].options.cwd).toBe(researchPath);

    const reset = await dispatch(runtime, '/clear-project');
    expect(reset[0]).toContain('对话和任务');

    await dispatch(runtime, '/new');
    const next = await dispatch(runtime, '新开一个对话');
    expect(next).toEqual(['agent:新开一个对话']);
    expect(agentTurns[1].options.cwd).toMatch(/conversation-\d{2}-\d{2}-\d{2}/);
  });
});
