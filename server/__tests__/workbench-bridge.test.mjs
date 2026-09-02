import { describe, expect, it, vi } from 'vitest';

import {
  WORKBENCH_MCP_SERVER_NAME,
  buildWorkbenchContext,
  buildWorkbenchMcpEnv,
  prependWorkbenchContext,
  resolveWorkbenchBridge,
  resolveWorkbenchMcpLauncher,
} from '../workbench-bridge.js';

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('workbench bridge', () => {
  it('creates a credential-isolated MCP config and bounded context', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(options.headers.Authorization).toBe('Bearer short-lived-token');
      if (url.endsWith('/meetings')) {
        return jsonResponse({ meetings: [{
          id: 'meeting-1', title: '课题进展', meetingDate: '2026-09-05T14:00:00.000Z',
          status: 'upcoming', myRole: 'presenter',
        }] });
      }
      if (url.includes('/calendar-todos?')) return jsonResponse({ todos: [{ id: 'todo-1', completed: false }] });
      return jsonResponse({ actions: [{ id: 'action-1', dueDate: '2026-08-31', status: 'open' }] });
    });
    const bridge = await resolveWorkbenchBridge({
      userId: 7,
      authSessionId: 'session-7',
      isPlatform: false,
      loadUser: () => ({ id: 7, username: 'researcher' }),
      generateAccessToken: vi.fn(() => 'short-lived-token'),
      resolvePort: () => 4321,
      resolveLauncher: () => ({ command: '/runtime/bin/node', script: '/runtime/workbench-mcp.cjs' }),
      fetchImpl,
    });

    expect(bridge.mcpServer).toMatchObject({
      command: '/runtime/bin/node',
      args: ['/runtime/workbench-mcp.cjs'],
      env: {
        MEDHELP_WORKBENCH_BASE_URL: 'http://127.0.0.1:4321/api/research',
        MEDHELP_WORKBENCH_TOKEN: 'short-lived-token',
      },
    });
    expect(bridge.prompt).toContain('课题进展');
    expect(bridge.prompt).toContain('未完成 action：1 条，其中逾期 1 条');
    expect(bridge.prompt).toContain('今日待办：1 条');
    expect(bridge.prompt.length).toBeLessThanOrEqual(1500);
    expect(bridge.prompt).not.toContain('short-lived-token');
    expect(prependWorkbenchContext('核对一下', bridge)).toBe(`${bridge.prompt}\n\n核对一下`);
    expect(WORKBENCH_MCP_SERVER_NAME).toBe('medhelp_workbench');
  });

  it('does not inject an authenticated bridge without a device-bound session', async () => {
    await expect(resolveWorkbenchBridge({
      userId: 7,
      authSessionId: null,
      isPlatform: false,
      loadUser: () => ({ id: 7 }),
    })).resolves.toBeNull();
  });

  it('degrades context fetch failures without blocking MCP injection', async () => {
    const bridge = await resolveWorkbenchBridge({
      userId: 7,
      authSessionId: 'session-7',
      isPlatform: false,
      loadUser: () => ({ id: 7 }),
      generateAccessToken: () => 'token',
      resolvePort: () => 4321,
      resolveLauncher: () => ({ command: '/runtime/bin/node', script: '/runtime/workbench-mcp.cjs' }),
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }),
    });

    expect(bridge.mcpServer).not.toBeNull();
    expect(bridge.prompt).toContain('工作台数据暂不可用');
    expect(bridge.diagnostic).toMatchObject({ code: 'workbench_context_unavailable' });
  });

  it('inherits only allowlisted process variables and can expose a read-only server', () => {
    expect(buildWorkbenchMcpEnv({
      platform: 'linux',
      env: { PATH: '/usr/bin', HOME: '/home/researcher', OPENAI_API_KEY: 'must-not-leak' },
      baseUrl: 'http://127.0.0.1:3001/api/research',
      token: 'token',
      readOnly: true,
    })).toEqual({
      HOME: '/home/researcher',
      PATH: '/usr/bin',
      MEDHELP_WORKBENCH_BASE_URL: 'http://127.0.0.1:3001/api/research',
      MEDHELP_WORKBENCH_TOKEN: 'token',
      MEDHELP_WORKBENCH_READ_ONLY: '1',
    });
  });

  it('resolves the packaged launcher and keeps fallback context inside its tags', () => {
    expect(resolveWorkbenchMcpLauncher({
      env: { MEDHELP_RUNTIME_ROOT: '/installed/runtime' },
      existsSync: () => true,
    })).toEqual({
      command: '/installed/runtime/bin/node',
      script: '/installed/runtime/workbench-mcp.cjs',
    });
    const context = buildWorkbenchContext(null, { bridgeAvailable: false });
    expect(context).toMatch(/^<medhelp_workbench_context>/);
    expect(context).toMatch(/<\/medhelp_workbench_context>$/);
  });
});
