import crypto from 'node:crypto';

export const AGENT_RUN_STATUSES = Object.freeze([
  'queued',
  'running',
  'completed',
  'failed',
  'parked',
  'cancelled',
]);

function parseJson(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerKey: row.owner_key,
    projectKey: row.project_key,
    runtimeId: row.runtime_id,
    sessionKey: row.session_key,
    sessionId: row.session_id,
    commandPreview: row.command_preview || '',
    request: parseJson(row.request_json),
    status: row.status,
    workerId: row.worker_id || null,
    leaseToken: row.lease_token || null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    retryable: row.retryable === 1,
    recoveryPolicy: row.recovery_policy,
    result: parseJson(row.result_json),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    updatedAt: row.updated_at,
  };
}

function json(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function ensureAgentRunSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      project_key TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      command_preview TEXT,
      request_json TEXT,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued', 'running', 'completed', 'failed', 'parked', 'cancelled')),
      worker_id TEXT,
      lease_token TEXT,
      lease_expires_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      retryable INTEGER NOT NULL DEFAULT 1,
      recovery_policy TEXT NOT NULL DEFAULT 'park'
        CHECK(recovery_policy IN ('park', 'retry')),
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_claim ON agent_runs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_lease ON agent_runs(status, lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_owner ON agent_runs(owner_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_key, created_at DESC);
  `);
}

export function createAgentRunStore(database, options = {}) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('Agent run store requires a better-sqlite3 database.');
  }
  ensureAgentRunSchema(database);
  const now = options.now || Date.now;

  const insertRun = database.prepare(`
    INSERT INTO agent_runs (
      id, owner_key, project_key, runtime_id, session_key, session_id,
      command_preview, request_json, status, attempts, max_attempts,
      retryable, recovery_policy, created_at, updated_at
    ) VALUES (
      @id, @ownerKey, @projectKey, @runtimeId, @sessionKey, @sessionId,
      @commandPreview, @requestJson, 'queued', 0, @maxAttempts,
      @retryable, @recoveryPolicy, @createdAt, @createdAt
    )
  `);
  const getRun = database.prepare('SELECT * FROM agent_runs WHERE id = ?');

  const claimTransaction = database.transaction((workerId, ttlMs) => {
    const current = now();
    const candidate = database.prepare(`
      SELECT id
      FROM agent_runs
      WHERE status = 'queued'
      ORDER BY created_at ASC, rowid ASC
      LIMIT 1
    `).get();
    if (!candidate) return null;
    const leaseToken = crypto.randomUUID();
    const changed = database.prepare(`
      UPDATE agent_runs
      SET status = 'running', worker_id = ?, lease_token = ?,
          lease_expires_at = ?, attempts = attempts + 1,
          started_at = COALESCE(started_at, ?), updated_at = ?,
          error_code = NULL, error_message = NULL
      WHERE id = ? AND status = 'queued'
    `).run(workerId, leaseToken, current + ttlMs, current, current, candidate.id);
    return changed.changes === 1 ? mapRow(getRun.get(candidate.id)) : null;
  });

  const store = {
    create(input) {
      const createdAt = now();
      const id = input.id || crypto.randomUUID();
      insertRun.run({
        id,
        ownerKey: String(input.ownerKey),
        projectKey: String(input.projectKey),
        runtimeId: String(input.runtimeId),
        sessionKey: String(input.sessionKey),
        sessionId: String(input.sessionId),
        commandPreview: String(input.commandPreview || '').slice(0, 500),
        requestJson: json(input.request),
        maxAttempts: Math.max(1, Number(input.maxAttempts || 3)),
        retryable: input.retryable === false ? 0 : 1,
        recoveryPolicy: input.recoveryPolicy === 'retry' ? 'retry' : 'park',
        createdAt,
      });
      return store.get(id);
    },

    get(id) {
      return mapRow(getRun.get(id));
    },

    list({ ownerKey, status, limit = 100 } = {}) {
      const clauses = [];
      const params = [];
      if (ownerKey !== undefined && ownerKey !== null) {
        clauses.push('owner_key = ?');
        params.push(String(ownerKey));
      }
      if (status) {
        if (!AGENT_RUN_STATUSES.includes(status)) throw new Error(`Invalid agent run status: ${status}`);
        clauses.push('status = ?');
        params.push(status);
      }
      params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
      return database.prepare(`
        SELECT * FROM agent_runs
        ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY created_at DESC
        LIMIT ?
      `).all(...params).map(mapRow);
    },

    claim(workerId, ttlMs) {
      return claimTransaction(String(workerId), Math.max(1_000, Number(ttlMs)));
    },

    heartbeat(id, leaseToken, ttlMs) {
      const current = now();
      return database.prepare(`
        UPDATE agent_runs
        SET lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND lease_token = ? AND status = 'running'
      `).run(current + Math.max(1_000, Number(ttlMs)), current, id, leaseToken).changes === 1;
    },

    complete(id, leaseToken, result) {
      const current = now();
      return database.prepare(`
        UPDATE agent_runs
        SET status = 'completed', result_json = ?, worker_id = NULL,
            lease_token = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?
        WHERE id = ? AND lease_token = ? AND status = 'running'
      `).run(json(result), current, current, id, leaseToken).changes === 1;
    },

    fail(id, leaseToken, error = {}, { retry = true } = {}) {
      const run = store.get(id);
      if (!run || run.status !== 'running' || run.leaseToken !== leaseToken) {
        return { updated: false, requeued: false, run };
      }
      const requeued = retry && run.retryable && run.attempts < run.maxAttempts;
      const current = now();
      database.prepare(`
        UPDATE agent_runs
        SET status = ?, worker_id = NULL, lease_token = NULL, lease_expires_at = NULL,
            error_code = ?, error_message = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND lease_token = ? AND status = 'running'
      `).run(
        requeued ? 'queued' : 'failed',
        error.code ? String(error.code).slice(0, 120) : null,
        String(error.message || error || 'Agent run failed').slice(0, 4_000),
        requeued ? null : current,
        current,
        id,
        leaseToken,
      );
      return { updated: true, requeued, run: store.get(id) };
    },

    park(id, leaseToken, error = {}) {
      const current = now();
      const params = [
        error.code ? String(error.code).slice(0, 120) : 'AGENT_RUN_PARKED',
        String(error.message || 'Agent run requires attention').slice(0, 4_000),
        current,
        current,
        id,
      ];
      let sql = `
        UPDATE agent_runs
        SET status = 'parked', worker_id = NULL, lease_token = NULL,
            lease_expires_at = NULL, error_code = ?, error_message = ?,
            finished_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `;
      if (leaseToken) {
        sql += ' AND lease_token = ?';
        params.push(leaseToken);
      }
      return database.prepare(sql).run(...params).changes === 1;
    },

    cancel(id, ownerKey = null) {
      const current = now();
      const params = [current, current, id];
      let sql = `
        UPDATE agent_runs
        SET status = 'cancelled', worker_id = NULL, lease_token = NULL,
            lease_expires_at = NULL, finished_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `;
      if (ownerKey !== null && ownerKey !== undefined) {
        sql += ' AND owner_key = ?';
        params.push(String(ownerKey));
      }
      return database.prepare(sql).run(...params).changes === 1;
    },

    release(id, leaseToken) {
      const current = now();
      return database.prepare(`
        UPDATE agent_runs
        SET status = 'queued', worker_id = NULL, lease_token = NULL,
            lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND lease_token = ? AND status = 'running'
      `).run(current, id, leaseToken).changes === 1;
    },

    reapExpired() {
      const current = now();
      const expired = database.prepare(`
        SELECT * FROM agent_runs
        WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
        ORDER BY lease_expires_at ASC
      `).all(current).map(mapRow);
      let requeued = 0;
      let parked = 0;
      for (const run of expired) {
        const canRetry = run.retryable
          && run.recoveryPolicy === 'retry'
          && run.attempts < run.maxAttempts;
        const nextStatus = canRetry ? 'queued' : 'parked';
        const result = database.prepare(`
          UPDATE agent_runs
          SET status = ?, worker_id = NULL, lease_token = NULL, lease_expires_at = NULL,
              error_code = 'AGENT_RUN_LEASE_EXPIRED',
              error_message = ?, finished_at = ?, updated_at = ?
          WHERE id = ? AND status = 'running' AND lease_token = ?
        `).run(
          nextStatus,
          canRetry
            ? 'The prior worker lease expired; the run was requeued.'
            : 'The prior worker lease expired; manual retry is required.',
          canRetry ? null : current,
          current,
          run.id,
          run.leaseToken,
        );
        if (result.changes === 1) {
          if (canRetry) requeued += 1;
          else parked += 1;
        }
      }
      return { scanned: expired.length, requeued, parked };
    },

    recoverOrphans(activeRunIds = []) {
      const active = new Set(activeRunIds);
      const running = database.prepare("SELECT * FROM agent_runs WHERE status = 'running'").all().map(mapRow);
      let requeued = 0;
      let parked = 0;
      for (const run of running) {
        if (active.has(run.id)) continue;
        const canRetry = run.retryable
          && run.recoveryPolicy === 'retry'
          && run.attempts < run.maxAttempts;
        const nextStatus = canRetry ? 'queued' : 'parked';
        const current = now();
        const result = database.prepare(`
          UPDATE agent_runs
          SET status = ?, worker_id = NULL, lease_token = NULL, lease_expires_at = NULL,
              error_code = 'AGENT_RUN_PROCESS_RESTARTED', error_message = ?,
              finished_at = ?, updated_at = ?
          WHERE id = ? AND status = 'running'
        `).run(
          nextStatus,
          canRetry
            ? 'The backend restarted; the run was requeued.'
            : 'The backend restarted; manual retry is required.',
          canRetry ? null : current,
          current,
          run.id,
        );
        if (result.changes === 1) {
          if (canRetry) requeued += 1;
          else parked += 1;
        }
      }
      return { scanned: running.length, requeued, parked };
    },

    stats() {
      const rows = database.prepare(`
        SELECT status, COUNT(*) AS count
        FROM agent_runs
        GROUP BY status
      `).all();
      const byStatus = Object.fromEntries(AGENT_RUN_STATUSES.map((status) => [status, 0]));
      for (const row of rows) byStatus[row.status] = Number(row.count || 0);
      return { byStatus, total: Object.values(byStatus).reduce((sum, count) => sum + count, 0) };
    },
  };

  return Object.freeze(store);
}
