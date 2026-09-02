import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const releaseDir = path.join(rootDir, 'release');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const kernelRuntimeDependencies = JSON.parse(
  await fs.readFile(path.join(rootDir, 'scripts', 'kernel-runtime-dependencies.json'), 'utf8'),
);
const version = String(packageJson.version || '').trim();
const npmArtifactName = `medhelp-${version}.tgz`;
const artifactName = `medhelp-cli-${version}.tgz`;
const npmArtifactPath = path.join(releaseDir, npmArtifactName);
const artifactPath = path.join(releaseDir, artifactName);
const publicDownloadDir = path.join(rootDir, 'public', 'downloads');
const publishedArtifactPath = path.join(publicDownloadDir, artifactName);
const manifestPath = path.join(publicDownloadDir, 'local-kernel-release.json');
const releaseNotesPath = path.join(rootDir, 'docs', 'releases', `${version}.md`);
const signingKeyPath = process.env.MEDHELP_KERNEL_UPDATE_SIGNING_KEY
  || path.join(os.homedir(), '.medhelp', 'release-signing', 'kernel-update-ed25519.pem');

await fs.mkdir(releaseDir, { recursive: true });
await fs.rm(npmArtifactPath, { force: true });
await fs.rm(artifactPath, { force: true });
await fs.rm(`${artifactPath}.sha256`, { force: true });

const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-kernel-package-'));
try {
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', releaseDir], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  execFileSync('tar', ['-xzf', npmArtifactPath, '-C', stagingRoot], { stdio: 'inherit' });

  const stagedPackageRoot = path.join(stagingRoot, 'package');
  const stagedPackagePath = path.join(stagedPackageRoot, 'package.json');
  const stagedPackage = JSON.parse(await fs.readFile(stagedPackagePath, 'utf8'));
  stagedPackage.dependencies = {
    ...(stagedPackage.dependencies || {}),
    ...kernelRuntimeDependencies,
  };
  await fs.writeFile(stagedPackagePath, `${JSON.stringify(stagedPackage, null, 2)}\n`, 'utf8');

  await fs.rm(npmArtifactPath, { force: true });
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', releaseDir], {
    cwd: stagedPackageRoot,
    stdio: 'inherit',
  });
} finally {
  await fs.rm(stagingRoot, { recursive: true, force: true });
}
await fs.rename(npmArtifactPath, artifactPath);

const bytes = await fs.readFile(artifactPath);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const privateKey = await fs.readFile(signingKeyPath, 'utf8').catch(() => {
  throw new Error(`Kernel update signing key not found: ${signingKeyPath}`);
});
const signature = crypto.sign(null, Buffer.from(sha256, 'hex'), privateKey).toString('base64');
const releaseNotes = (await fs.readFile(releaseNotesPath, 'utf8')).trim();
await fs.writeFile(`${artifactPath}.sha256`, `${sha256}  ${artifactName}\n`, 'utf8');
await fs.mkdir(publicDownloadDir, { recursive: true });
await fs.copyFile(artifactPath, publishedArtifactPath);
await fs.writeFile(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  product: 'MedHelp Kernel',
  version,
  publishedAt: new Date().toISOString(),
  notes: releaseNotes,
  windows: {
    package: artifactName,
    sha256,
    signature,
    signatureAlgorithm: 'ed25519-sha256',
    bytes: bytes.byteLength,
  },
}, null, 2)}\n`, 'utf8');

console.log(`${artifactPath} (${Math.ceil(bytes.byteLength / 1024 / 1024)} MB)`);
console.log(`${artifactPath}.sha256`);
console.log(publishedArtifactPath);
console.log(manifestPath);
