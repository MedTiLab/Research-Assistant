#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const runtimeSource = path.resolve(process.argv[2] || path.join(rootDir, 'build', 'secure-headless-kernel'));
const packagingSource = path.join(rootDir, 'packaging', 'macos', 'local-engine');
const workDir = path.join(rootDir, 'build', 'macos-kernel-pkg');
const payloadRoot = path.join(workDir, 'root');
const scriptsDir = path.join(workDir, 'scripts');
const installRoot = path.join(payloadRoot, 'Library', 'Application Support', 'MedHelp Kernel');
const runtimeTarget = path.join(installRoot, 'runtime');
const launchAgentsDir = path.join(payloadRoot, 'Library', 'LaunchAgents');
const localBinDir = path.join(payloadRoot, 'usr', 'local', 'bin');
const releaseDir = path.join(rootDir, 'release');
const dmgStageDir = path.join(workDir, 'dmg');

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  });
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

if (process.platform !== 'darwin') {
  throw new Error('The macOS Kernel installer must be built on macOS.');
}

const runtimePackage = JSON.parse(await fs.readFile(path.join(runtimeSource, 'package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(runtimeSource, 'security-manifest.json'), 'utf8'));
const version = String(runtimePackage.version || manifest.version || '0.0.0');
const arch = String(manifest.arch || process.arch);
const releaseArch = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : arch;
const unsignedPkgPath = path.join(releaseDir, `MedHelp-Kernel_${version}_darwin-${releaseArch}.pkg`);
const signingIdentity = String(process.env.MEDHELP_INSTALLER_IDENTITY || '').trim();
const finalPkgPath = signingIdentity
  ? path.join(releaseDir, `MedHelp-Kernel_${version}_darwin-${releaseArch}-signed.pkg`)
  : unsignedPkgPath;
const dmgPath = path.join(releaseDir, `MedHelp-Kernel-Installer_${version}_darwin-${releaseArch}.dmg`);
const executableRelativePath = process.platform === 'win32' ? 'bin/medhelp-kernel.exe' : 'bin/medhelp-kernel';
const executableSource = path.join(runtimeSource, executableRelativePath);
const nodeRuntimeRelativePath = 'bin/node';
const nodeRuntimeSource = path.join(runtimeSource, nodeRuntimeRelativePath);

if (manifest.platform !== 'darwin' || manifest.arch !== process.arch) {
  throw new Error(`Runtime is for ${manifest.platform}/${manifest.arch}, but this machine is darwin/${process.arch}.`);
}
if (manifest.policy?.rawFirstPartySourceBundled !== false) {
  throw new Error('Security manifest does not confirm that raw first-party source is excluded.');
}

const executableDigest = await sha256(executableSource);
if (manifest.files?.[executableRelativePath] !== executableDigest) {
  throw new Error('Compiled Kernel checksum does not match security-manifest.json.');
}
const nodeRuntimeDigest = await sha256(nodeRuntimeSource);
if (manifest.files?.[nodeRuntimeRelativePath] !== nodeRuntimeDigest) {
  throw new Error('Bundled Node runtime checksum does not match security-manifest.json.');
}

await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(runtimeTarget, { recursive: true });
await fs.mkdir(launchAgentsDir, { recursive: true });
await fs.mkdir(localBinDir, { recursive: true });
await fs.mkdir(scriptsDir, { recursive: true });
await fs.mkdir(releaseDir, { recursive: true });
await fs.rm(unsignedPkgPath, { force: true });
await fs.rm(dmgPath, { force: true });
if (finalPkgPath !== unsignedPkgPath) {
  await fs.rm(finalPkgPath, { force: true });
}

run('ditto', ['--noextattr', '--noqtn', '--noacl', runtimeSource, runtimeTarget]);
await fs.writeFile(
  path.join(runtimeTarget, 'bin', 'medhelp-kernel.sha256'),
  `${executableDigest}  medhelp-kernel\n`,
  'utf8',
);
await fs.copyFile(
  path.join(packagingSource, 'com.yzglab.medhelp.kernel.plist'),
  path.join(launchAgentsDir, 'com.yzglab.medhelp.kernel.plist'),
);
await fs.copyFile(path.join(packagingSource, 'run-kernel.sh'), path.join(installRoot, 'run-kernel.sh'));
await fs.copyFile(path.join(packagingSource, 'medhelp-kernelctl'), path.join(localBinDir, 'medhelp-kernelctl'));
await fs.copyFile(path.join(packagingSource, 'postinstall'), path.join(scriptsDir, 'postinstall'));

await fs.chmod(path.join(runtimeTarget, 'bin', 'medhelp-kernel'), 0o755);
await fs.chmod(path.join(runtimeTarget, nodeRuntimeRelativePath), 0o755);
await fs.chmod(path.join(installRoot, 'run-kernel.sh'), 0o755);
await fs.chmod(path.join(localBinDir, 'medhelp-kernelctl'), 0o755);
await fs.chmod(path.join(scriptsDir, 'postinstall'), 0o755);
run('chmod', ['-R', 'a+rX', payloadRoot]);
run('xattr', ['-cr', payloadRoot]);
run('dot_clean', ['-m', payloadRoot]);
run('plutil', ['-lint', path.join(launchAgentsDir, 'com.yzglab.medhelp.kernel.plist')]);
run('codesign', ['--verify', '--strict', path.join(runtimeTarget, 'bin', 'medhelp-kernel')]);
run('codesign', ['--verify', '--strict', path.join(runtimeTarget, nodeRuntimeRelativePath)]);

run('pkgbuild', [
  '--root', payloadRoot,
  '--scripts', scriptsDir,
  '--identifier', 'com.yzglab.medhelp.kernel.pkg',
  '--version', version,
  '--install-location', '/',
  '--ownership', 'recommended',
  unsignedPkgPath,
]);

if (signingIdentity) {
  run('productsign', ['--sign', signingIdentity, unsignedPkgPath, finalPkgPath]);
}

const pkgDigest = await sha256(finalPkgPath);
const stat = await fs.stat(finalPkgPath);
await fs.writeFile(`${finalPkgPath}.sha256`, `${pkgDigest}  ${path.basename(finalPkgPath)}\n`, 'utf8');

await fs.mkdir(dmgStageDir, { recursive: true });
await fs.copyFile(finalPkgPath, path.join(dmgStageDir, 'Install MedHelp Kernel.pkg'));
run('hdiutil', [
  'create',
  '-volname', 'MedHelp Kernel Installer',
  '-srcfolder', dmgStageDir,
  '-ov',
  '-format', 'UDZO',
  dmgPath,
]);
const dmgDigest = await sha256(dmgPath);
const dmgStat = await fs.stat(dmgPath);
await fs.writeFile(`${dmgPath}.sha256`, `${dmgDigest}  ${path.basename(dmgPath)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  packagePath: finalPkgPath,
  dmgPath,
  version,
  arch,
  bytes: stat.size,
  sha256: pkgDigest,
  dmgBytes: dmgStat.size,
  dmgSha256: dmgDigest,
  signed: Boolean(signingIdentity),
  installMode: 'headless-launch-agent',
  desktopApplicationBundled: false,
}, null, 2));
