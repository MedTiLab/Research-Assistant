import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultSdkPath = fileURLToPath(import.meta.resolve('@openai/codex-sdk'));

export function patchCodexSdkWindowsHide(source) {
  const spawnPattern = /const child = spawn\(this\.executablePath, commandArgs, \{\s*env,\s*signal: args\.signal\s*\}\);/g;
  const matches = String(source).match(spawnPattern) || [];
  if (matches.length !== 1) {
    throw new Error(`Expected one Codex SDK process spawn, found ${matches.length}.`);
  }
  return String(source).replace(spawnPattern, [
    'const child = spawn(this.executablePath, commandArgs, {',
    '      env,',
    '      signal: args.signal,',
    '      windowsHide: true',
    '    });',
  ].join('\n'));
}

export function createCodexSdkWindowsHidePlugin({ sdkPath = defaultSdkPath } = {}) {
  return {
    name: 'codex-sdk-windows-hide',
    setup(build) {
      build.onResolve({ filter: /^@openai\/codex-sdk$/ }, () => ({
        path: sdkPath,
        namespace: 'codex-sdk-windows-hide',
      }));
      build.onLoad({ filter: /.*/, namespace: 'codex-sdk-windows-hide' }, async () => ({
        contents: patchCodexSdkWindowsHide(await fs.readFile(sdkPath, 'utf8')),
        loader: 'js',
        resolveDir: path.dirname(sdkPath),
      }));
    },
  };
}
