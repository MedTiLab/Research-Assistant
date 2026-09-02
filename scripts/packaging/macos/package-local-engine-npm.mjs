import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHeadlessNpmPackage } from '../local-engine/package-npm.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

buildHeadlessNpmPackage({
  outputDir: path.join(rootDir, 'build', 'macos-headless-npm'),
  expectedPlatform: 'darwin',
  expectedArch: 'arm64',
})
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
