#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { createCodexSdkWindowsHidePlugin } from './codex-sdk-build-plugin.mjs';
import { ensureNodePtySpawnHelperExecutable } from './node-pty-spawn-helper.mjs';
import { countSkillDirectories } from '../desktop/common/skillBundleValidation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'build', 'secure-headless-kernel');
const binDir = path.join(outputDir, 'bin');
const buildDir = path.join(outputDir, '.build');
const rootPackage = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const kernelRuntimeDependencies = JSON.parse(
  await fs.readFile(path.join(rootDir, 'scripts', 'kernel-runtime-dependencies.json'), 'utf8'),
);
const embeddedInitSql = await fs.readFile(path.join(rootDir, 'server', 'database', 'init.sql'), 'utf8');
const executableName = process.platform === 'win32' ? null : 'medhelp-kernel';
const executablePath = executableName ? path.join(binDir, executableName) : null;
const nodeRuntimeName = process.platform === 'win32' ? 'node.exe' : 'node';
const nodeRuntimePath = path.join(binDir, nodeRuntimeName);
const runtimeBundleName = process.platform === 'win32' ? 'kernel-entry.cjs' : null;
const runtimeBundlePath = runtimeBundleName ? path.join(outputDir, runtimeBundleName) : null;
const kernelBundlePath = path.join(buildDir, 'kernel-entry.cjs');
const kernelMetaPath = path.join(buildDir, 'kernel-meta.json');
const agentComputeMcpBundleName = 'agent-compute-mcp.cjs';
const agentComputeMcpBundlePath = path.join(outputDir, agentComputeMcpBundleName);
const workbenchMcpBundleName = 'workbench-mcp.cjs';
const workbenchMcpBundlePath = path.join(outputDir, workbenchMcpBundleName);
const seaConfigPath = path.join(buildDir, 'sea-config.json');
const seaBlobPath = path.join(buildDir, 'kernel.blob');
const builtinNames = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, ''), `node:${name}`]));
const nativeRuntimePackages = ['bcrypt', 'better-sqlite3', 'node-pty', 'sharp', 'sqlite3'];
// pdfkit loads its built-in AFM metrics and ICC profile from disk at runtime.
// Playwright also resolves browser metadata, helper scripts, and lazy imports
// relative to its package. Keep these packages external and ship them beside
// the compiled Kernel so their runtime paths remain intact.
const assetRuntimePackages = ['pdfkit', 'playwright'];
// These packages expose runtime entry points from directories that otherwise
// look like removable build source. Keep the complete package so externalized
// runtimes remain loadable after pruning.
const runtimeSourcePackages = new Set(['js-md5', 'playwright', 'playwright-core']);
const dynamicRuntimePackages = Object.keys(kernelRuntimeDependencies);
const pinnedAgentPackages = Object.freeze([
  '@anthropic-ai/claude-agent-sdk',
  '@openai/codex',
  '@openai/codex-sdk',
]);
const pinnedAgentPackageVersions = Object.freeze(Object.fromEntries(
  pinnedAgentPackages.map((packageName) => [packageName, rootPackage.dependencies?.[packageName]]),
));
const optionalNativePackages = new Set(['bufferutil', 'utf-8-validate']);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const platformKey = `${process.platform}-${process.arch}`;
const removableDependencyDirectories = new Set([
  '.github', '.vscode', 'benchmark', 'benchmarks', 'coverage', 'deps', 'doc', 'docs',
  'example', 'examples', 'scripts', 'source', 'src', 'test', 'tests', 'third_party',
]);
const removableDependencyExtensions = new Set([
  '.bat', '.c', '.cc', '.cpp', '.cxx', '.gyp', '.gypi', '.h', '.hh', '.hpp',
  '.map', '.mk', '.pdb', '.ps1', '.py', '.sh', '.ts', '.tsx', '.yml', '.yaml',
]);

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  });
}

function runNpm(args, options = {}) {
  const npmCliPath = String(process.env.npm_execpath || '').trim();
  if (npmCliPath) {
    run(process.execPath, [npmCliPath, ...args], options);
    return;
  }
  run(npmCommand, args, {
    shell: process.platform === 'win32',
    ...options,
  });
}

function packageName(importPath) {
  if (importPath.startsWith('@')) {
    return importPath.split('/').slice(0, 2).join('/');
  }
  return importPath.split('/')[0];
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function pruneDependencyBuildArtifacts(directory, nodeModulesRoot = directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const relativeParts = path.relative(nodeModulesRoot, entryPath).split(path.sep).filter(Boolean);
    const dependencyName = relativeParts[0]?.startsWith('@')
      ? relativeParts.slice(0, 2).join('/')
      : relativeParts[0];
    const preservePackageBuildFiles = nativeRuntimePackages.includes(dependencyName)
      || runtimeSourcePackages.has(dependencyName);
    if (entry.isDirectory()) {
      const lowerName = entry.name.toLowerCase();
      if (removableDependencyDirectories.has(lowerName) && !preservePackageBuildFiles) {
        await fs.rm(entryPath, { recursive: true, force: true });
      } else if (lowerName === 'prebuilds') {
        for (const prebuild of await fs.readdir(entryPath, { withFileTypes: true })) {
          const prebuildPath = path.join(entryPath, prebuild.name);
          if (!prebuild.isDirectory() || prebuild.name.toLowerCase() !== platformKey) {
            await fs.rm(prebuildPath, { recursive: true, force: true });
          } else {
            await pruneDependencyBuildArtifacts(prebuildPath, nodeModulesRoot);
          }
        }
      } else {
        await pruneDependencyBuildArtifacts(entryPath, nodeModulesRoot);
      }
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const lowerName = entry.name.toLowerCase();
    if (
      lowerName.startsWith('._')
      || lowerName === '.dockerignore'
      || lowerName === '.editorconfig'
      || lowerName === '.eslintrc'
      || lowerName === '.gitattributes'
      || lowerName === '.gitignore'
      || lowerName === '.nycrc'
      || lowerName === 'dockerfile'
      || lowerName === 'dockerfile-alpine'
      || (!preservePackageBuildFiles && removableDependencyExtensions.has(path.extname(lowerName)))
    ) {
      await fs.rm(entryPath, { force: true });
    }
  }
}

if (process.platform !== 'darwin' && process.platform !== 'win32') {
  throw new Error(`Secure headless Kernel builds are not configured for ${process.platform}.`);
}

for (const packageName of pinnedAgentPackages) {
  const expectedVersion = rootPackage.dependencies?.[packageName];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion || '')) {
    throw new Error(`Agent package must use an exact version: ${packageName}@${expectedVersion || 'missing'}.`);
  }
  const installedPackage = JSON.parse(await fs.readFile(
    path.join(rootDir, 'node_modules', ...packageName.split('/'), 'package.json'),
    'utf8',
  ));
  if (installedPackage.version !== expectedVersion) {
    throw new Error(
      `Agent package version mismatch: ${packageName} expected ${expectedVersion}, found ${installedPackage.version}.`,
    );
  }
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(binDir, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });

// Pi runs in a separate Node process. Ship its compiled Host and pinned SDKs
// in a relocatable runtime rather than depending on a developer's data folder.
const piRuntimeDir = path.join(outputDir, 'pi-runtime');
run(process.execPath, [
  path.join(rootDir, 'scripts', 'prepare-pi-runtime.mjs'),
  '--output-dir', piRuntimeDir,
  '--bundle-host',
]);

await build({
  entryPoints: [path.join(rootDir, 'server', 'pi-runtime', 'document-worker.js')],
  outfile: path.join(piRuntimeDir, 'document-worker.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', minify: true,
});
await fs.copyFile(
  path.join(rootDir, 'server', 'pi-runtime', 'document-worker-NOTICE.txt'),
  path.join(piRuntimeDir, 'document-worker-NOTICE.txt'),
);

const kernelBuild = await build({
  entryPoints: [path.join(rootDir, 'server', 'index.js')],
  outfile: kernelBundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: [...nativeRuntimePackages, ...assetRuntimePackages],
  minify: true,
  sourcemap: false,
  metafile: true,
  legalComments: 'none',
  plugins: [createCodexSdkWindowsHidePlugin()],
  define: {
    'import.meta.url': '__MEDHELP_IMPORT_META_URL__',
  },
  banner: {
    js: [
      'process.env.NODE_ENV = process.env.NODE_ENV || "production";',
      'process.env.MEDHELP_ENV = process.env.MEDHELP_ENV || "production";',
      'process.env.MEDHELP_LOCAL_KERNEL = "1";',
      'process.env.MEDHELP_LOCAL_HOST = process.env.MEDHELP_LOCAL_HOST || "127.0.0.1";',
      'process.env.MEDHELP_LOCAL_PORT = process.env.MEDHELP_LOCAL_PORT || "5055";',
      'process.env.MEDHELP_LOCAL_KERNEL_SERVE_APP = "0";',
      'process.env.MEDHELP_SECURE_DISTRIBUTION = "1";',
      `process.env.npm_package_version = ${JSON.stringify(rootPackage.version)};`,
      `globalThis.__MEDHELP_EMBEDDED_INIT_SQL__ = ${JSON.stringify(embeddedInitSql)};`,
      'require = require("node:module").createRequire(process.execPath);',
      'const __MEDHELP_IMPORT_META_URL__ = require("node:url").pathToFileURL(process.execPath).href;',
    ].join(' '),
  },
});
await fs.writeFile(kernelMetaPath, `${JSON.stringify(kernelBuild.metafile, null, 2)}\n`, 'utf8');

await build({
  entryPoints: [path.join(rootDir, 'server', 'bin', 'agent-compute-mcp.js')],
  outfile: agentComputeMcpBundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: nativeRuntimePackages,
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js: 'process.env.NODE_ENV = process.env.NODE_ENV || "production";',
  },
});

await build({
  entryPoints: [path.join(rootDir, 'server', 'bin', 'workbench-mcp.js')],
  outfile: workbenchMcpBundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js: 'process.env.NODE_ENV = process.env.NODE_ENV || "production";',
  },
});

const dependencyNames = new Set();
for (const output of Object.values(kernelBuild.metafile.outputs)) {
  for (const item of output.imports || []) {
    if (!item.external || builtinNames.has(item.path) || item.path.startsWith('node:')) {
      continue;
    }
    const name = packageName(item.path);
    if (!optionalNativePackages.has(name)) {
      dependencyNames.add(name);
    }
  }
}
for (const name of dynamicRuntimePackages) {
  dependencyNames.add(name);
}
for (const name of pinnedAgentPackages) {
  dependencyNames.add(name);
}

const secureDependencies = {};
for (const name of [...dependencyNames].sort()) {
  const version = rootPackage.dependencies?.[name] || kernelRuntimeDependencies[name];
  if (!version) {
    throw new Error(`Secure Kernel dependency ${name} is not declared in package.json dependencies.`);
  }
  secureDependencies[name] = version;
}

await fs.writeFile(path.join(outputDir, 'package.json'), `${JSON.stringify({
  name: 'medhelp-secure-headless-kernel-runtime',
  version: rootPackage.version,
  private: true,
  dependencies: secureDependencies,
}, null, 2)}\n`, 'utf8');

runNpm(['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: outputDir });
for (const [packageName, expectedVersion] of Object.entries(pinnedAgentPackageVersions)) {
  const runtimePackagePath = path.join(outputDir, 'node_modules', ...packageName.split('/'), 'package.json');
  const runtimePackage = JSON.parse(await fs.readFile(runtimePackagePath, 'utf8'));
  if (runtimePackage.version !== expectedVersion) {
    throw new Error(
      `Bundled Agent package version mismatch: ${packageName} expected ${expectedVersion}, found ${runtimePackage.version}.`,
    );
  }
}
await pruneDependencyBuildArtifacts(path.join(outputDir, 'node_modules'));

// node-pty's macOS prebuild can be installed with spawn-helper mode 0644.
// Password and interactive SSH both launch through that helper, so a packaged
// Kernel would otherwise fail at runtime with "posix_spawnp failed" even
// though /usr/bin/ssh is present. Repair it before electron-builder copies and
// signs the runtime into the app bundle.
const nodePtySpawnHelper = ensureNodePtySpawnHelperExecutable({
  runtimeRoot: outputDir,
});
if (nodePtySpawnHelper.repaired) {
  console.log(`[kernel-build] Repaired node-pty spawn helper permissions: ${nodePtySpawnHelper.helperPath}`);
}

const nodeLicenseCandidates = [
  path.join(path.dirname(process.execPath), 'LICENSE'),
  path.join(path.dirname(process.execPath), 'LICENSE.md'),
  path.join(path.dirname(path.dirname(process.execPath)), 'LICENSE'),
  path.join(path.dirname(path.dirname(process.execPath)), 'LICENSE.md'),
];
for (const candidate of nodeLicenseCandidates) {
  try {
    await fs.copyFile(candidate, path.join(outputDir, 'NODE-LICENSE'));
    break;
  } catch {
    // Try the next standard Node.js distribution license location.
  }
}
await fs.copyFile(path.join(rootDir, 'LICENSE'), path.join(outputDir, 'LICENSE'));
await fs.copyFile(path.join(rootDir, 'NOTICE'), path.join(outputDir, 'NOTICE'));

// esbuild bundles JavaScript only. Skills and the agent rule templates are read
// from disk with fs at runtime, so they have to travel beside the executable —
// a Kernel without them starts fine and then serves a stock agent with no
// MedHelp rules and no skills. The launcher points MEDHELP_SKILLS_DIR and
// MEDHELP_TEMPLATES_DIR at these directories.
const skillsTarget = path.join(outputDir, 'skills');
const skillsSource = path.join(rootDir, 'skills');
const templatesTarget = path.join(outputDir, 'templates');
const newsScriptsTarget = path.join(outputDir, 'scripts', 'research-news');
const sourceSkillCount = await countSkillDirectories(skillsSource);
if (sourceSkillCount <= 0) {
  throw new Error(`Secure Kernel source contains no skills under ${skillsSource}.`);
}

await fs.cp(skillsSource, skillsTarget, {
  recursive: true,
  dereference: true,
  filter: (source) => {
    const name = path.basename(source);
    return name !== '__pycache__'
      && name !== '.DS_Store'
      && !name.endsWith('.pyc')
      && !name.toLowerCase().endsWith('.zip');
  },
});

await fs.mkdir(templatesTarget, { recursive: true });
for (const template of ['CLAUDE.md', 'AGENTS.md']) {
  await fs.copyFile(
    path.join(rootDir, 'server', 'templates', template),
    path.join(templatesTarget, template),
  );
}

// The Literature Monitor routes execute these Python programs at runtime.
// They are operational Kernel assets, not product frontend or server source.
// Keep only the runnable scripts and omit machine-local Python caches.
await fs.cp(
  path.join(rootDir, 'server', 'scripts', 'research-news'),
  newsScriptsTarget,
  {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return name !== '__pycache__'
        && name !== '.DS_Store'
        && !name.endsWith('.pyc');
    },
  },
);
const newsScriptCount = (await fs.readdir(newsScriptsTarget))
  .filter((name) => name.endsWith('.py'))
  .length;
if (newsScriptCount === 0) {
  throw new Error('Secure Kernel build bundled no Literature Monitor scripts.');
}

const bundledSkillCount = await countSkillDirectories(skillsTarget);
if (bundledSkillCount !== sourceSkillCount) {
  throw new Error(
    `Secure Kernel skill copy is incomplete: source has ${sourceSkillCount}, bundled runtime has ${bundledSkillCount}.`,
  );
}

await fs.writeFile(seaConfigPath, `${JSON.stringify({
  main: kernelBundlePath,
  output: seaBlobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgv: ['--no-warnings'],
  execArgvExtension: 'none',
}, null, 2)}\n`, 'utf8');

let executableBuffer = null;
let runtimeBundleBuffer = null;

if (process.platform === 'win32') {
  // Windows Defender commonly quarantines modified Node SEA executables. Keep
  // the bundled Node binary untouched and launch the compiled kernel bundle
  // with it; the package remains headless and excludes raw first-party source.
  await fs.copyFile(kernelBundlePath, runtimeBundlePath);
  await fs.copyFile(process.execPath, nodeRuntimePath);
  await fs.chmod(nodeRuntimePath, 0o755);
} else {
  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
  await fs.copyFile(process.execPath, executablePath);
  await fs.chmod(executablePath, 0o755);
  await fs.copyFile(process.execPath, nodeRuntimePath);
  await fs.chmod(nodeRuntimePath, 0o755);
  run('codesign', ['--remove-signature', executablePath]);

  const postjectArgs = [
    executablePath,
    'NODE_SEA_BLOB',
    seaBlobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  run(process.execPath, [path.join(rootDir, 'node_modules', 'postject', 'dist', 'cli.js'), ...postjectArgs]);
  run('codesign', ['--force', '--sign', '-', executablePath]);
  run('codesign', ['--force', '--sign', '-', nodeRuntimePath]);
  executableBuffer = await fs.readFile(executablePath);
}

if (runtimeBundlePath) {
  runtimeBundleBuffer = await fs.readFile(runtimeBundlePath);
}

const nodeRuntimeBuffer = await fs.readFile(nodeRuntimePath);
const agentComputeMcpBuffer = await fs.readFile(agentComputeMcpBundlePath);
const workbenchMcpBuffer = await fs.readFile(workbenchMcpBundlePath);
const manifestFiles = {
  [`bin/${nodeRuntimeName}`]: sha256(nodeRuntimeBuffer),
  [agentComputeMcpBundleName]: sha256(agentComputeMcpBuffer),
  [workbenchMcpBundleName]: sha256(workbenchMcpBuffer),
  'pi-runtime/sdk-host.mjs': sha256(await fs.readFile(path.join(piRuntimeDir, 'sdk-host.mjs'))),
  'pi-runtime/document-worker.cjs': sha256(await fs.readFile(path.join(piRuntimeDir, 'document-worker.cjs'))),
  'pi-runtime/document-worker-NOTICE.txt': sha256(await fs.readFile(path.join(piRuntimeDir, 'document-worker-NOTICE.txt'))),
  'pi-runtime/manifest.json': sha256(await fs.readFile(path.join(piRuntimeDir, 'manifest.json'))),
};
if (executableBuffer) {
  manifestFiles[`bin/${executableName}`] = sha256(executableBuffer);
}
if (runtimeBundleBuffer) {
  manifestFiles[runtimeBundleName] = sha256(runtimeBundleBuffer);
}
await fs.writeFile(path.join(outputDir, 'security-manifest.json'), `${JSON.stringify({
  schemaVersion: 2,
  product: 'MedHelp Secure Headless Kernel',
  version: rootPackage.version,
  platform: process.platform,
  arch: process.arch,
  policy: {
    desktopApplicationBundled: false,
    // Skills and rule templates ship as files beside the executable: the CLI
    // agents discover skills through a directory, and the templates are used as
    // symlink targets and paths, so neither can live inside the binary.
    skillsBundled: true,
    ruleTemplatesBundled: true,
    literatureMonitorRuntimeBundled: true,
    rawFirstPartySourceBundled: false,
    sourceMapsBundled: false,
    hostedApplicationOnly: true,
    nodeRuntimeBundledForCliAgents: true,
    piRuntimeBundled: true,
    windowsNodeBundleRuntime: process.platform === 'win32',
  },
  assets: {
    skillsDir: 'skills',
    skillCount: bundledSkillCount,
    templatesDir: 'templates',
    literatureMonitorScriptsDir: 'scripts/research-news',
    literatureMonitorScriptCount: newsScriptCount,
    ...(runtimeBundleName ? { kernelEntry: runtimeBundleName } : {}),
    agentComputeMcp: agentComputeMcpBundleName,
    workbenchMcp: workbenchMcpBundleName,
    piRuntimeDir: 'pi-runtime',
  },
  nodeRuntime: {
    version: process.versions.node,
    modules: process.versions.modules,
  },
  files: manifestFiles,
  runtimeDependencies: secureDependencies,
  agentPackages: pinnedAgentPackageVersions,
  nativeRuntimeDependencies: nativeRuntimePackages.filter((name) => secureDependencies[name]),
}, null, 2)}\n`, 'utf8');

await fs.rm(buildDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  outputDir,
  executablePath,
  runtimeBundlePath,
  agentComputeMcpBundlePath,
  workbenchMcpBundlePath,
  bundledSkillCount,
  newsScriptCount,
  version: rootPackage.version,
  platform: process.platform,
  arch: process.arch,
  dependencyCount: Object.keys(secureDependencies).length,
  sha256: executableBuffer ? sha256(executableBuffer) : sha256(runtimeBundleBuffer),
  nodeRuntimeSha256: sha256(nodeRuntimeBuffer),
}, null, 2));
