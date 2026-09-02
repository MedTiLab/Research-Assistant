import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRendererRecoveryPolicy } from './rendererRecovery.mjs';

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Renderer recovery policy', () => {
  it('allows one automatic reload and breaks a repeated crash loop', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-renderer-recovery-'));
    directories.push(directory);
    const filePath = path.join(directory, 'renderer-failures.json');
    let time = 1_000;
    const policy = createRendererRecoveryPolicy({ filePath, now: () => time });

    expect(policy.registerFailure()).toEqual({ failureCount: 1, autoReloadAllowed: true });
    time += 1_000;
    expect(policy.registerFailure()).toEqual({ failureCount: 2, autoReloadAllowed: false });
    time += 5 * 60_000 + 1;
    expect(policy.registerFailure()).toEqual({ failureCount: 1, autoReloadAllowed: true });
  });
});
