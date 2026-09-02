import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('account conversation archive', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-account-conversations-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it('upserts one account-owned record per provider session', async () => {
    const { accountConversationDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('history-owner', 'hash');

    const created = accountConversationDb.upsert({
      userId: user.id,
      sessionId: 'session-a',
      provider: 'codex',
      title: 'First title',
      projectLabel: 'Study A',
      messages: [{ role: 'user', content: 'Question', timestamp: '2026-07-15T00:00:00.000Z' }],
    });
    const updated = accountConversationDb.upsert({
      userId: user.id,
      sessionId: 'session-a',
      provider: 'codex',
      title: 'Updated title',
      projectLabel: 'Study A',
      messages: [
        { role: 'user', content: 'Question', timestamp: '2026-07-15T00:00:00.000Z' },
        { role: 'assistant', content: 'Answer', timestamp: '2026-07-15T00:00:01.000Z' },
      ],
    });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('Updated title');
    expect(updated.messageCount).toBe(2);
    expect(accountConversationDb.listForUser(user.id).total).toBe(1);
  });

  it('keeps reads and deletes isolated by account', async () => {
    const { accountConversationDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const owner = userDb.createUser('history-owner', 'hash');
    const other = userDb.createUser('history-other', 'hash');
    const conversation = accountConversationDb.upsert({
      userId: owner.id,
      sessionId: 'session-private',
      provider: 'claude',
      title: 'Private conversation',
      messages: [{ role: 'user', content: 'Private', timestamp: '2026-07-15T00:00:00.000Z' }],
    });

    expect(accountConversationDb.getForUser(other.id, conversation.id)).toBeNull();
    expect(accountConversationDb.deleteForUser(other.id, conversation.id)).toBe(false);
    expect(accountConversationDb.getForUser(owner.id, conversation.id)?.title).toBe('Private conversation');
  });
});
