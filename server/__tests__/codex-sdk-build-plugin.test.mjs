import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { patchCodexSdkWindowsHide } from '../../scripts/codex-sdk-build-plugin.mjs';

describe('secure Kernel Codex SDK build patch', () => {
  it('hides the native Codex child window on Windows', async () => {
    const sdkPath = import.meta.resolve('@openai/codex-sdk');
    const sdkSource = await fs.readFile(new URL(sdkPath), 'utf8');
    const patched = patchCodexSdkWindowsHide(sdkSource);

    expect(patched).toContain('signal: args.signal,\n      windowsHide: true');
    expect(patched).not.toBe(sdkSource);
  });

  it('fails closed if the pinned SDK changes its spawn implementation', () => {
    expect(() => patchCodexSdkWindowsHide('export class Codex {}'))
      .toThrow(/Expected one Codex SDK process spawn/);
  });
});
