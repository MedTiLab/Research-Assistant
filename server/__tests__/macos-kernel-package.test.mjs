import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('macOS Kernel package', () => {
  it('verifies runtime checksums during npm packaging', async () => {
    const npmBuilder = await readFile(
      new URL('../../scripts/packaging/local-engine/package-npm.mjs', import.meta.url),
      'utf8',
    );

    expect(npmBuilder).toContain('security-manifest.json');
    expect(npmBuilder).toContain('checksum does not match security-manifest.json');
    expect(npmBuilder).toContain('failed SHA-256 verification');
  });

  it('bundles the Literature Monitor runtime scripts without Python caches', async () => {
    const builder = await readFile(
      new URL('../../scripts/build-secure-headless-kernel.mjs', import.meta.url),
      'utf8',
    );

    expect(builder).toContain("path.join(rootDir, 'server', 'scripts', 'research-news')");
    expect(builder).toContain("name !== '__pycache__'");
    expect(builder).toContain("literatureMonitorScriptsDir: 'scripts/research-news'");
  });
});
