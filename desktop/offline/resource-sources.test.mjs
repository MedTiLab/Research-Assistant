import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const policy = JSON.parse(await fs.readFile(
  new URL('./resource-sources.json', import.meta.url),
  'utf8',
));

describe('offline desktop resource source policy', () => {
  it('derives the bundled skill count from the Kernel security manifest', () => {
    const kernel = policy.bundled.find((entry) => entry.id === 'local-kernel');
    expect(kernel?.skillCountSource).toBe('kernel-security-manifest');
    expect(kernel).not.toHaveProperty('expectedSkillCount');
  });

  it('keeps accounts and conversation archives in the local bundle', () => {
    expect(policy.bundled).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local-accounts', source: 'local-kernel' }),
    ]));
    expect(policy.onlineRequired.map((entry) => entry.id)).not.toContain('authorization');
    expect(policy.onlineRequired.map((entry) => entry.id)).not.toContain('account-control-plane');
  });

  it('bundles the local help page and keeps API documentation online-only', () => {
    expect(policy.bundled).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'help', source: 'local-build' }),
    ]));
    expect(policy.onlineRequired.map((entry) => entry.id)).not.toContain('help');
    expect(policy.onlineRequired).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'api-documentation', bundled: false, delivery: 'system-browser' }),
    ]));
    expect(policy.excludedFromBundle).not.toContain('dist/help.html');
    expect(policy.excludedFromBundle).toEqual(expect.arrayContaining([
      'dist/images/help',
      'dist/api-docs.html',
    ]));
  });
});
