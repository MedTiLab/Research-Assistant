import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot;

async function loadModules() {
  vi.resetModules();
  const db = await import('../database/db.js');
  const memory = await import('../user-memory/automatic-user-memory.js');
  return { ...db, ...memory };
}

describe('long-term user memory', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-long-term-memory-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('stores memory independently from preferences and injects a separate block', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      userLongTermMemoryDb,
      prependUserMemoryToPrompt,
    } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('separate-memory-user', 'hash');

    userPreferenceMemoryDb.create(user.id, 'Prefer short answers', 'preference');
    userLongTermMemoryDb.create(user.id, 'The user is preparing a December 2026 thesis submission.', { source: 'manual' });

    expect(userPreferenceMemoryDb.getAll(user.id)).toHaveLength(1);
    expect(userLongTermMemoryDb.getAll(user.id)).toHaveLength(1);
    const prompt = prependUserMemoryToPrompt('继续', user.id);
    expect(prompt).toContain('<user_memory>');
    expect(prompt).toContain('December 2026 thesis submission');
    expect(prompt).not.toContain('Prefer short answers');
    expect(prompt).not.toContain('<user_preferences>');
  });

  it('deduplicates automatic captures and keeps independent recall/capture settings', async () => {
    const { initializeDatabase, userDb, userLongTermMemoryDb } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('automatic-memory-user', 'hash');
    const first = userLongTermMemoryDb.capture(user.id, ['The user leads the cohort study.'], { conversationId: 'thread-1' });
    const second = userLongTermMemoryDb.capture(user.id, ['  The user leads the cohort study.  '], { conversationId: 'thread-2' });

    expect(first.added).toBe(1);
    expect(second.added).toBe(0);
    expect(userLongTermMemoryDb.getAll(user.id)).toHaveLength(1);
    expect(userLongTermMemoryDb.setSettings(user.id, { enabled: false })).toEqual({
      enabled: false,
      autoCaptureEnabled: true,
    });
    expect(userLongTermMemoryDb.setSettings(user.id, { autoCaptureEnabled: false })).toEqual({
      enabled: false,
      autoCaptureEnabled: false,
    });
  });

  it('promotes a duplicate automatic fact when the user saves it manually', async () => {
    const { initializeDatabase, userDb, userLongTermMemoryDb } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('promoted-memory-user', 'hash');
    const automatic = userLongTermMemoryDb.create(user.id, 'The thesis deadline is December 2026.', {
      source: 'automatic',
      conversationId: 'thread-1',
    });
    const manual = userLongTermMemoryDb.create(user.id, 'The thesis deadline is December 2026.', {
      source: 'manual',
      pinned: true,
    });

    expect(manual.created).toBe(false);
    expect(manual.memory).toMatchObject({ id: automatic.memory.id, source: 'manual', pinned: true });
    expect(userLongTermMemoryDb.getAll(user.id)).toHaveLength(1);
  });

  it('extracts and captures facts after a completed turn', async () => {
    const { createUserMemoryBurstBuffer } = await loadModules();
    const capture = vi.fn(async (facts) => ({ added: facts.length, memories: facts }));
    const enqueue = createUserMemoryBurstBuffer({ quietMs: 0 });
    await enqueue({
      ownerId: 'user-1',
      conversationId: 'thread-1',
      input: '我的博士论文计划在2026年12月提交。',
      reply: '好的，我会据此安排时间线。',
      oneShot: async () => JSON.stringify({ facts: ['The user plans to submit their doctoral thesis in December 2026.'] }),
      capture,
    });

    expect(capture).toHaveBeenCalledWith(
      ['The user plans to submit their doctoral thesis in December 2026.'],
      { conversationId: 'thread-1' },
    );
  });

  it('rejects secrets and personal identifiers before persistence or extraction', async () => {
    const {
      initializeDatabase,
      parseUserMemoryFacts,
      userDb,
      userLongTermMemoryDb,
    } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('safe-memory-user', 'hash');

    expect(parseUserMemoryFacts(JSON.stringify({ facts: [
      'The user is submitting a thesis in December 2026.',
      'The API key is sk-testfixture12.',
      '用户手机号是 13812345678。',
    ] }))).toEqual(['The user is submitting a thesis in December 2026.']);
    expect(() => userLongTermMemoryDb.create(user.id, '密码是 super-secret-value', { source: 'manual' }))
      .toThrow(/secret or personal identifier/i);
    expect(userLongTermMemoryDb.getAll(user.id)).toHaveLength(0);
  });

  it('ranks recall by the current query and always includes pinned facts', async () => {
    const { selectRelevantUserMemories } = await loadModules();
    const memories = [
      { id: 1, content: 'The user is writing a doctoral thesis.', source: 'automatic', pinned: false },
      { id: 2, content: 'The cohort sample size is 500 participants.', source: 'automatic', pinned: false },
      { id: 3, content: 'The user must submit an annual report in October.', source: 'manual', pinned: true },
    ];

    const selected = selectRelevantUserMemories(memories, '请继续规划 doctoral thesis 写作时间线', { maxItems: 2 });
    expect(selected.map((memory) => memory.id)).toEqual([3, 1]);
    expect(selected.map((memory) => memory.id)).not.toContain(2);
  });

  it('protects manual and pinned memories when the automatic store reaches its limit', async () => {
    const { initializeDatabase, userDb, userLongTermMemoryDb } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('bounded-memory-user', 'hash');
    const manual = userLongTermMemoryDb.create(user.id, 'The user manually curated this durable fact.', { source: 'manual' }).memory;
    const pinned = userLongTermMemoryDb.create(user.id, 'Pinned automatic fact.', { source: 'automatic', pinned: true }).memory;
    for (let index = 0; index < 298; index += 1) {
      userLongTermMemoryDb.create(user.id, `Automatic fact number ${index}.`, { source: 'automatic' });
    }

    const overflow = userLongTermMemoryDb.create(user.id, 'Newest automatic fact.', { source: 'automatic' });
    expect(overflow.created).toBe(true);
    expect(userLongTermMemoryDb.getStats(user.id)).toMatchObject({ total: 300, manual: 1, pinned: 1 });
    expect(userLongTermMemoryDb.getById(user.id, manual.id)).not.toBeNull();
    expect(userLongTermMemoryDb.getById(user.id, pinned.id)).not.toBeNull();
  });
});
