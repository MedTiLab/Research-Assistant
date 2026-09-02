import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPiRuntime } from '../agent-runtime/pi-runtime.js';
import {
  isPiMcpAllowed,
  readPiMcpAccess,
  setPiMcpAccess,
} from '../pi-runtime/mcp-access.js';

let dataDir;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-mcp-access-'));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('Pi MCP access control', () => {
  it('enables the workbench by default and persists explicit permission per user', async () => {
    const storageOptions = { dataDir };
    expect(isPiMcpAllowed(await readPiMcpAccess({ userId: 'one', storageOptions }), 'medhelp_workbench')).toBe(true);
    expect(isPiMcpAllowed(await readPiMcpAccess({ userId: 'one', storageOptions }), 'medhelp_compute')).toBe(false);
    await setPiMcpAccess('medhelp_workbench', false, { userId: 'one', storageOptions });
    expect(isPiMcpAllowed(await readPiMcpAccess({ userId: 'one', storageOptions }), 'medhelp_workbench')).toBe(false);
    expect(isPiMcpAllowed(await readPiMcpAccess({ userId: 'two', storageOptions }), 'medhelp_workbench')).toBe(true);
  });

  it('rejects malformed ids and non-boolean access values', async () => {
    await expect(setPiMcpAccess('../escape', true, { userId: 'one', storageOptions: { dataDir } })).rejects.toThrow('Invalid');
    await expect(setPiMcpAccess('valid', 'true', { userId: 'one', storageOptions: { dataDir } })).rejects.toThrow('boolean');
  });

  it('projects only the default-enabled workbench bridge until compute access is allowed', async () => {
    const computeBridgeResolver = vi.fn(async () => ({ prompt: 'compute data', mcpServer: { command: '/node', args: [], env: {} } }));
    const workbenchBridgeResolver = vi.fn(async () => ({ prompt: 'workbench status', mcpServer: { command: '/node', args: [], env: {} } }));
    const hostManager = {
      isFauxHost: () => false,
      diagnostics: async () => ({ available: true }),
      isActive: () => false,
      getActiveSessions: () => [],
      getStartTime: () => null,
      shutdown: async () => {},
    };
    const runtime = createPiRuntime({ hostManager, computeBridgeResolver, workbenchBridgeResolver });
    try {
      const denied = await runtime.native.diagnostics({ userId: 'one', storageOptions: { dataDir } });
      expect(denied.resources.trustedMcpServers).toBe(1);
      expect(computeBridgeResolver).not.toHaveBeenCalled();
      expect(workbenchBridgeResolver).toHaveBeenCalledOnce();

      await setPiMcpAccess('medhelp_compute', true, { userId: 'one', storageOptions: { dataDir } });
      const allowed = await runtime.native.diagnostics({ userId: 'one', storageOptions: { dataDir } });
      expect(allowed.resources.trustedMcpServers).toBe(2);
      expect(workbenchBridgeResolver).toHaveBeenCalledTimes(2);
      expect(computeBridgeResolver).toHaveBeenCalledOnce();
    } finally {
      await runtime.native.shutdown();
    }
  });
});
