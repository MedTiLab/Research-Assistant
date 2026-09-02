import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadConnectorModules() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  const agentEnv = await import('../utils/databaseApiAgentEnv.js');
  const connector = await import('../utils/databaseApiConnector.js');
  return { database, agentEnv, connector };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe('database API Connector-owned connection state', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-database-connector-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it('verifies the PAT against sources without returning or logging the token', async () => {
    const { connector } = await loadConnectorModules();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
      sources: [{ id: 'cfps' }, { id: 'mimiciv' }],
    }));

    const result = await connector.verifyDatabaseApiConnection({
      baseUrl: 'https://api.example.test',
      token: 'secret-pat',
      fetchImpl,
    });

    expect(result).toMatchObject({
      connected: true,
      status: 'connected',
      accessibleSourceCount: 2,
    });
    expect(result).not.toHaveProperty('token');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/sources',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-pat' }),
      }),
    );
  });

  it('returns an explicit code-owned invalid credential state for a 401', async () => {
    const { connector } = await loadConnectorModules();
    const result = await connector.verifyDatabaseApiConnection({
      baseUrl: 'https://api.example.test',
      token: 'rejected-pat',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(401, { error: 'nope' })),
    });

    expect(result).toMatchObject({ connected: false, status: 'invalid_credentials' });
  });

  it('does not call an authenticated but zero-source account connected', async () => {
    const { connector } = await loadConnectorModules();
    const result = await connector.verifyDatabaseApiConnection({
      baseUrl: 'https://api.example.test',
      token: 'no-database-access',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { sources: [] })),
    });

    expect(result).toMatchObject({
      connected: false,
      status: 'access_denied',
      accessibleSourceCount: 0,
    });
  });

  it('injects a user token only after the Connector has verified that account', async () => {
    const { database, agentEnv, connector } = await loadConnectorModules();
    const userA = database.userDb.createUser('connector-user-a', 'hash');
    const userB = database.userDb.createUser('connector-user-b', 'hash');
    database.credentialsDb.createCredential(
      userA.id,
      'Database API URL',
      agentEnv.DATABASE_API_BASE_URL_CREDENTIAL_TYPE,
      'https://api.example.test',
    );
    database.credentialsDb.createCredential(
      userA.id,
      'Database API token',
      agentEnv.DATABASE_API_TOKEN_CREDENTIAL_TYPE,
      'user-a-pat',
    );

    expect(agentEnv.getDatabaseApiAgentEnvForUser(userA.id)).toEqual({
      MEDHELP_DATABASE_API_CONNECTION_STATUS: 'unverified',
    });

    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { sources: [{ id: 'cfps' }] }));
    const connection = await connector.ensureDatabaseApiConnectionForUser(userA.id, {
      force: true,
      fetchImpl,
    });

    expect(connection).toMatchObject({ connected: true, status: 'connected' });
    expect(agentEnv.getDatabaseApiAgentEnvForUser(userA.id)).toMatchObject({
      MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
      MEDHELP_DATABASE_API_TOKEN: 'user-a-pat',
    });
    expect(agentEnv.getDatabaseApiAgentEnvForUser(userB.id)).toEqual({
      MEDHELP_DATABASE_API_CONNECTION_STATUS: 'not_configured',
    });
    expect(agentEnv.withDatabaseApiAgentEnv({
      MEDHELP_MANAGED_AGENT_SESSION: '1',
      DATABASE_API_TOKEN: 'global-token-must-not-leak',
    }, userB.id)).toMatchObject({
      MEDHELP_MANAGED_AGENT_SESSION: '1',
      MEDHELP_DATABASE_API_CONNECTION_STATUS: 'not_configured',
    });
    expect(agentEnv.withDatabaseApiAgentEnv({
      MEDHELP_MANAGED_AGENT_SESSION: '1',
      DATABASE_API_TOKEN: 'global-token-must-not-leak',
    }, userB.id)).not.toHaveProperty('DATABASE_API_TOKEN');

    await connector.ensureDatabaseApiConnectionForUser(userA.id, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
