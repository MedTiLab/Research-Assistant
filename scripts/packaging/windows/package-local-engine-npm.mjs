#!/usr/bin/env node

import { buildWindowsHeadlessNpmPackage } from '../local-engine/package-npm.mjs';

buildWindowsHeadlessNpmPackage()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
