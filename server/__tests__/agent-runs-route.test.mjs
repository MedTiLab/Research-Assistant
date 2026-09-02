import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunsRouter } from '../routes/agent-runs.js';

let server;

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  server = null;
});

async function fixture(dependencies, userId = 7) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/agent-runs', createAgentRunsRouter(dependencies));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}/api/agent-runs`;
}

describe('agent runs API', () => {
  it('scopes listings to the authenticated owner and hides persisted request details', async () => {
    const list = vi.fn(() => [{
      id: 'run-1',
      ownerKey: '7',
      status: 'running',
      request: { commandLength: 12 },
      leaseToken: 'private-lease',
    }]);
    const base = await fixture({
      list,
      engineStatus: () => ({ configuredWorkers: 3, activeRuns: 1 }),
    });

    const response = await fetch(`${base}?status=running&limit=20`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({ ownerKey: '7', status: 'running', limit: 20 });
    expect(payload.runs).toEqual([{ id: 'run-1', ownerKey: '7', status: 'running' }]);
    expect(payload.engine).toMatchObject({ configuredWorkers: 3 });
  });

  it('does not reveal or cancel another owner\'s run', async () => {
    const cancel = vi.fn();
    const base = await fixture({
      get: () => ({ id: 'other-run', ownerKey: '8', status: 'running' }),
      cancel,
    });

    expect((await fetch(`${base}/other-run`)).status).toBe(404);
    expect((await fetch(`${base}/other-run/cancel`, { method: 'POST' })).status).toBe(404);
    expect(cancel).toHaveBeenCalledWith('other-run', '7');
  });
});
