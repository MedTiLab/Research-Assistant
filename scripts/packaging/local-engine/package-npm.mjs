import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const defaultRuntimeSource = path.join(rootDir, 'build', 'secure-headless-kernel');
const defaultOutputDir = path.join(rootDir, 'build', 'windows-headless-npm');
const defaultPackDestination = path.join(rootDir, 'release');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const forbiddenPackageRoots = new Set(['dist', 'server', 'shared', 'desktop', 'src', 'public', 'skills', 'scripts']);
const bundledRuntimePackages = Object.freeze([
  '@embedpdf/fonts-sc',
  '@openai/codex',
  'pdfkit',
]);
const pinnedRuntimePackages = Object.freeze([
  '@embedpdf/fonts-sc',
  '@openai/codex',
]);
const requiredDocumentExportAssets = Object.freeze([
  path.join('node_modules', '@embedpdf', 'fonts-sc', 'fonts', 'NotoSansHans-Regular.otf'),
  path.join('node_modules', '@embedpdf', 'fonts-sc', 'fonts', 'NotoSansHans-Bold.otf'),
  path.join('node_modules', 'pdfkit', 'js', 'data', 'Helvetica.afm'),
  path.join('node_modules', 'pdfkit', 'js', 'data', 'Courier.afm'),
  path.join('node_modules', 'js-md5', 'src', 'md5.js'),
]);
const runtimeTargets = Object.freeze({
  'win32-x64': {
    node: 'bin/node.exe',
    entry: 'kernel-entry.cjs',
    label: 'Windows x64',
  },
  'darwin-arm64': {
    executable: 'bin/medhelp-kernel',
    node: 'bin/node',
    label: 'macOS Apple silicon',
  },
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
  return sha256(await fs.readFile(filePath));
}

function runNpmPack(args, options = {}) {
  const npmCliPath = String(process.env.npm_execpath || '').trim();
  return execFileSync(
    npmCliPath ? process.execPath : npmCommand,
    npmCliPath ? [npmCliPath, ...args] : args,
    {
      shell: !npmCliPath && process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    },
  );
}

async function assertRuntime(runtimeSource, {
  expectedPlatform,
  expectedArch,
  allowCrossPlatform = false,
} = {}) {
  const target = runtimeTargets[`${expectedPlatform}-${expectedArch}`];
  if (!target) throw new Error(`Unsupported npm Kernel target: ${expectedPlatform}/${expectedArch}.`);
  if (!allowCrossPlatform && (process.platform !== expectedPlatform || process.arch !== expectedArch)) {
    throw new Error(
      `The ${target.label} npm package must be built on ${expectedPlatform}/${expectedArch}, not ${process.platform}/${process.arch}.`,
    );
  }

  const runtimePackage = JSON.parse(await fs.readFile(path.join(runtimeSource, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(runtimeSource, 'security-manifest.json'), 'utf8'));
  const version = String(runtimePackage.version || manifest.version || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid Kernel version: ${version}`);
  }
  if (
    manifest.platform !== expectedPlatform
    || manifest.arch !== expectedArch
    || manifest.version !== version
  ) {
    throw new Error(
      `Runtime is for ${manifest.platform}/${manifest.arch}, not ${expectedPlatform}/${expectedArch}.`,
    );
  }
  if (
    manifest.policy?.desktopApplicationBundled !== false
    || manifest.policy?.rawFirstPartySourceBundled !== false
    || manifest.policy?.sourceMapsBundled !== false
    || manifest.policy?.hostedApplicationOnly !== true
  ) {
    throw new Error('Runtime security manifest does not satisfy the headless npm policy.');
  }

  const runtimeFiles = [];
  if (target.executable) runtimeFiles.push(target.executable);
  runtimeFiles.push(target.node);
  if (target.entry) runtimeFiles.push(target.entry);
  for (const relativePath of runtimeFiles) {
    const digest = await sha256File(path.join(runtimeSource, relativePath));
    if (manifest.files?.[relativePath] !== digest) {
      throw new Error(`${relativePath} checksum does not match security-manifest.json.`);
    }
  }
  for (const packageName of Object.keys(manifest.runtimeDependencies || {})) {
    const packageManifestPath = path.join(runtimeSource, 'node_modules', ...packageName.split('/'), 'package.json');
    if (!fsSync.existsSync(packageManifestPath)) {
      throw new Error(`Runtime dependency is missing before npm packaging: ${packageName}.`);
    }
  }
  for (const packageName of pinnedRuntimePackages) {
    const expectedVersion = manifest.runtimeDependencies?.[packageName];
    if (!expectedVersion) {
      throw new Error(`Bundled runtime package is missing from runtime dependencies: ${packageName}.`);
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
      throw new Error(`Bundled runtime package must use an exact version: ${packageName}@${expectedVersion}.`);
    }
    const installedManifest = JSON.parse(await fs.readFile(
      path.join(runtimeSource, 'node_modules', ...packageName.split('/'), 'package.json'),
      'utf8',
    ));
    if (installedManifest.version !== expectedVersion) {
      throw new Error(
        `Bundled runtime package version mismatch: ${packageName} expected ${expectedVersion}, found ${installedManifest.version}.`,
      );
    }
  }
  return { manifest, runtimePackage, target, version };
}

async function auditPackageDirectory(packageDir, runtimeDependencies, target) {
  const roots = await fs.readdir(packageDir);
  for (const forbidden of forbiddenPackageRoots) {
    if (roots.includes(forbidden)) {
      throw new Error(`Forbidden package root included: ${forbidden}`);
    }
  }
  if (roots.some((entry) => /electron|app\.asar/i.test(entry))) {
    throw new Error('Electron content is forbidden in the headless npm package.');
  }

  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'security-manifest.json'), 'utf8'));
  const packageJson = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'));
  if (fsSync.existsSync(path.join(packageDir, 'runtime', 'node_modules'))) {
    throw new Error('Node packages must be installed by npm instead of nested in the Kernel tarball.');
  }
  if (JSON.stringify(packageJson.dependencies || {}) !== JSON.stringify(runtimeDependencies)) {
    throw new Error('Headless npm dependencies do not match the secure runtime manifest.');
  }
  for (const relativePath of requiredDocumentExportAssets) {
    if (!fsSync.existsSync(path.join(packageDir, relativePath))) {
      throw new Error(`Document export runtime asset is missing: ${relativePath}`);
    }
  }
  const runtimeFiles = [];
  if (target.executable) runtimeFiles.push(target.executable);
  runtimeFiles.push(target.node);
  if (target.entry) runtimeFiles.push(target.entry);
  for (const relativePath of runtimeFiles) {
    const packagePath = path.join(packageDir, 'runtime', relativePath);
    if (manifest.files?.[relativePath] !== await sha256File(packagePath)) {
      throw new Error(`Packaged ${relativePath} failed SHA-256 verification.`);
    }
  }

  const launcher = await fs.readFile(path.join(packageDir, 'bin', 'medhelp-kernelctl.mjs'), 'utf8');
  if (launcher.includes('sourceMappingURL') || /BrowserWindow|electron/i.test(launcher)) {
    throw new Error('The npm launcher contains a source map or frontend runtime.');
  }
}

export async function buildHeadlessNpmPackage({
  runtimeSource = defaultRuntimeSource,
  outputDir,
  packDestination = defaultPackDestination,
  expectedPlatform,
  expectedArch,
  allowCrossPlatform = false,
} = {}) {
  const resolvedRuntimeSource = path.resolve(runtimeSource);
  const resolvedOutputDir = path.resolve(
    outputDir || path.join(rootDir, 'build', `${expectedPlatform}-${expectedArch}-headless-npm`),
  );
  const resolvedPackDestination = path.resolve(packDestination);
  const { manifest, target, version } = await assertRuntime(resolvedRuntimeSource, {
    expectedPlatform,
    expectedArch,
    allowCrossPlatform,
  });

  await fs.rm(resolvedOutputDir, { recursive: true, force: true });
  await fs.mkdir(path.join(resolvedOutputDir, 'bin'), { recursive: true });
  await fs.cp(resolvedRuntimeSource, path.join(resolvedOutputDir, 'runtime'), { recursive: true });
  const runtimeDependencies = Object.fromEntries(
    Object.entries(manifest.runtimeDependencies || {}).sort(([left], [right]) => left.localeCompare(right)),
  );
  await fs.rm(path.join(resolvedOutputDir, 'runtime', 'node_modules'), { recursive: true, force: true });
  // npm normally resolves dependencies again on the customer machine. Copy the
  // already verified build-time dependency tree to the package root so npm can
  // embed the pinned Claude and Codex SDKs as private bundled dependencies.
  await fs.cp(
    path.join(resolvedRuntimeSource, 'node_modules'),
    path.join(resolvedOutputDir, 'node_modules'),
    { recursive: true },
  );
  await fs.copyFile(
    path.join(resolvedRuntimeSource, 'security-manifest.json'),
    path.join(resolvedOutputDir, 'security-manifest.json'),
  );
  await fs.copyFile(path.join(rootDir, 'npm', 'windows-headless', 'README.md'), path.join(resolvedOutputDir, 'README.md'));
  await fs.copyFile(path.join(rootDir, 'LICENSE'), path.join(resolvedOutputDir, 'LICENSE'));
  await fs.copyFile(path.join(rootDir, 'NOTICE'), path.join(resolvedOutputDir, 'NOTICE'));

  await build({
    entryPoints: [path.join(rootDir, 'npm', 'windows-headless', 'cli.mjs')],
    outfile: path.join(resolvedOutputDir, 'bin', 'medhelp-kernelctl.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    define: {
      __MEDHELP_KERNEL_VERSION__: JSON.stringify(version),
    },
  });
  const launcherPath = path.join(resolvedOutputDir, 'bin', 'medhelp-kernelctl.mjs');
  await fs.writeFile(
    launcherPath,
    `#!/usr/bin/env node\n${await fs.readFile(launcherPath, 'utf8')}`,
    'utf8',
  );
  await fs.chmod(launcherPath, 0o755);

  const packageJson = {
    // Keep the legacy package identity so npm performs an in-place upgrade of
    // the existing `medhelp` global bin instead of treating it as a collision.
    name: 'medhelp',
    version,
    description: `Secure headless MedHelp Kernel runtime for ${target.label}`,
    license: 'SEE LICENSE IN LICENSE',
    type: 'module',
    os: [expectedPlatform],
    cpu: [expectedArch],
    bin: {
      medhelp: 'bin/medhelp-kernelctl.mjs',
      'medhelp-kernelctl': 'bin/medhelp-kernelctl.mjs',
    },
    files: [
      'bin/medhelp-kernelctl.mjs',
      'runtime/',
      'security-manifest.json',
      'README.md',
      'LICENSE',
      'NOTICE',
    ],
    scripts: {
      postinstall: 'node bin/medhelp-kernelctl.mjs postinstall',
      preuninstall: 'node bin/medhelp-kernelctl.mjs preuninstall',
    },
    engines: {
      node: '>=20',
    },
    dependencies: runtimeDependencies,
    bundledDependencies: bundledRuntimePackages,
    repository: {
      type: 'git',
      url: 'git+https://github.com/MedTiLab/Research-Assistant.git',
    },
    homepage: 'https://app.medtimehelp.com/',
    medhelpDistribution: {
      kind: 'secure-headless-kernel',
      platform: expectedPlatform,
      arch: expectedArch,
      desktopApplicationBundled: false,
      rawFirstPartySourceBundled: false,
      runtimeSha256: manifest.files,
      runtimeDependencies,
    },
  };
  await fs.writeFile(
    path.join(resolvedOutputDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8',
  );

  await auditPackageDirectory(resolvedOutputDir, runtimeDependencies, target);
  await fs.mkdir(resolvedPackDestination, { recursive: true });
  const packOutput = runNpmPack(
    ['pack', '--json', '--ignore-scripts', '--pack-destination', resolvedPackDestination],
    { cwd: resolvedOutputDir, encoding: 'utf8' },
  );
  const packed = JSON.parse(packOutput)[0];
  const npmTarballPath = path.join(resolvedPackDestination, packed.filename);
  const tarballPath = path.join(
    resolvedPackDestination,
    `medhelp-kernel-${expectedPlatform}-${expectedArch}-${version}.tgz`,
  );
  if (npmTarballPath !== tarballPath) {
    await fs.rm(tarballPath, { force: true });
    await fs.rename(npmTarballPath, tarballPath);
  }
  const tarball = await fs.readFile(tarballPath);
  const digest = sha256(tarball);
  await fs.writeFile(`${tarballPath}.sha256`, `${digest}  ${path.basename(tarballPath)}\n`, 'utf8');

  return {
    ok: true,
    packageName: packageJson.name,
    version,
    outputDir: resolvedOutputDir,
    tarballPath,
    sha256: digest,
    bytes: tarball.byteLength,
    fileCount: packed.entryCount,
    unpackedBytes: packed.unpackedSize,
    desktopApplicationBundled: false,
  };
}

export function buildWindowsHeadlessNpmPackage(options = {}) {
  return buildHeadlessNpmPackage({
    outputDir: defaultOutputDir,
    ...options,
    expectedPlatform: 'win32',
    expectedArch: 'x64',
  });
}
