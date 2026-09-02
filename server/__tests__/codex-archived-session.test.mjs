import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

let tempRoot = null;

describe('archived Codex sessions', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-codex-archive-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  it('keeps an archived rollout listed and readable after Codex moves its file', async () => {
    const projectPath = path.join(tempRoot, 'workspace');
    const sessionId = '019fe000-0000-7000-8000-000000000001';
    const archiveDir = path.join(tempRoot, '.medhelpsec', 'codex_home', 'archived_sessions');
    const archiveFile = path.join(archiveDir, `rollout-2026-08-11T00-00-00-${sessionId}.jsonl`);

    await mkdir(projectPath, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
    await writeFile(archiveFile, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-08-11T00:00:00.000Z',
        payload: { id: sessionId, cwd: projectPath, model: 'gpt-5' },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-08-11T00:01:00.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Archived conversation content' }],
        },
      }),
      '',
    ].join('\n'));

    vi.resetModules();
    const projects = await import('../projects.js');
    const sessions = await projects.getCodexSessions(projectPath, { limit: 10 });
    const history = await projects.getCodexSessionMessages(sessionId);

    expect(sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sessionId, archived: true, filePath: archiveFile }),
    ]));
    expect(history.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.objectContaining({ content: 'Archived conversation content' }) }),
    ]));
  });
});
