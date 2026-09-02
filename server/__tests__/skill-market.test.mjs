import crypto from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  installSkillMarketEntry,
  isSafeMarketRelativePath,
  parseMarketSkillId,
  SkillMarketError,
  uninstallSkillMarketEntry,
} from '../utils/skillMarket.js';

const tempRoots = [];

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-skill-market-test-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('skill market package safety', () => {
  it('accepts nested relative paths and rejects traversal or reserved metadata', () => {
    expect(isSafeMarketRelativePath('SKILL.md')).toBe(true);
    expect(isSafeMarketRelativePath('references/guide.md')).toBe(true);
    expect(isSafeMarketRelativePath('../outside')).toBe(false);
    expect(isSafeMarketRelativePath('references/../../outside')).toBe(false);
    expect(isSafeMarketRelativePath('/absolute/path')).toBe(false);
    expect(isSafeMarketRelativePath('.medhelp-market.json')).toBe(false);
  });

  it('parses only known provider ids with safe slugs', () => {
    expect(parseMarketSkillId('skillhub:literature-review')).toEqual({
      source: 'skillhub',
      slug: 'literature-review',
    });
    expect(parseMarketSkillId('unknown:skill')).toBeNull();
    expect(parseMarketSkillId('clawhub:../skill')).toBeNull();
  });
});

describe('skill market installation', () => {
  it('atomically installs and only uninstalls a market-managed user skill', async () => {
    const root = await createTempRoot();
    const userSkillsDir = path.join(root, 'users', 'account-1', 'skills');
    const systemSkillsDir = path.join(root, 'system-skills');
    const files = new Map([
      ['SKILL.md', Buffer.from('---\nname: market-demo\ndescription: Market demo\n---\n# Demo\n')],
      ['references/guide.md', Buffer.from('# Guide\n')],
    ]);
    const detail = {
      id: 'skillhub:market-demo',
      source: 'skillhub',
      slug: 'market-demo',
      name: 'Market Demo',
      version: '1.0.0',
      installable: true,
      files: Array.from(files, ([filePath, content]) => ({
        path: filePath,
        size: content.length,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
      })),
    };

    const installed = await installSkillMarketEntry({
      source: 'skillhub',
      slug: 'market-demo',
      userSkillsDir,
      systemSkillsDir,
      detail,
      fetchFile: async (_source, _slug, filePath) => files.get(filePath),
    });

    expect(installed.skill.installState).toBe('installed');
    expect(await fs.readFile(path.join(userSkillsDir, 'market-demo', 'SKILL.md'), 'utf8')).toContain('name: market-demo');
    const metadata = JSON.parse(await fs.readFile(
      path.join(userSkillsDir, 'market-demo', '.medhelp-market.json'),
      'utf8',
    ));
    expect(metadata).toMatchObject({ id: 'skillhub:market-demo', fileCount: 2 });

    await uninstallSkillMarketEntry({ source: 'skillhub', slug: 'market-demo', userSkillsDir });
    await expect(fs.access(path.join(userSkillsDir, 'market-demo'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a checksum mismatch and leaves no published skill directory', async () => {
    const root = await createTempRoot();
    const userSkillsDir = path.join(root, 'skills');
    const detail = {
      id: 'clawhub:bad-digest',
      source: 'clawhub',
      slug: 'bad-digest',
      name: 'Bad digest',
      installable: true,
      files: [{ path: 'SKILL.md', size: 20, sha256: '0'.repeat(64) }],
    };

    await expect(installSkillMarketEntry({
      source: 'clawhub',
      slug: 'bad-digest',
      userSkillsDir,
      detail,
      fetchFile: async () => Buffer.from('---\nname: bad-digest\n---\n'),
    })).rejects.toMatchObject({ code: 'SKILL_CHECKSUM_MISMATCH' });
    await expect(fs.access(path.join(userSkillsDir, 'bad-digest'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never removes an unmanaged user-created skill directory', async () => {
    const root = await createTempRoot();
    const userSkillsDir = path.join(root, 'skills');
    await fs.mkdir(path.join(userSkillsDir, 'personal-skill'), { recursive: true });
    await fs.writeFile(path.join(userSkillsDir, 'personal-skill', 'SKILL.md'), '# personal\n');

    await expect(uninstallSkillMarketEntry({
      source: 'skillhub',
      slug: 'personal-skill',
      userSkillsDir,
    })).rejects.toBeInstanceOf(SkillMarketError);
    await expect(fs.access(path.join(userSkillsDir, 'personal-skill', 'SKILL.md'))).resolves.toBeUndefined();
  });
});
