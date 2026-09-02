import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../../..');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const fromVersion = String(process.argv[2] || '').trim();
const targetVersion = String(packageJson.version || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(fromVersion)) {
  throw new Error('Usage: node scripts/packaging/windows/build-local-engine-patch.mjs <from-version>');
}
if (!/^\d+\.\d+\.\d+$/.test(targetVersion) || fromVersion === targetVersion) {
  throw new Error(`Invalid target version: ${targetVersion}`);
}

const databaseSkills = [
  'cfps-skill',
  'cgss-skill',
  'charls-skill',
  'chfs-skill',
  'chip-skill',
  'chns-skill',
  'clds-skill',
  'clhls-skill',
  'css-skill',
  'share-skill',
  'hrs-skill',
  'elsa-skill',
  'klosa-skill',
  'lasi-skill',
  'mhas-skill',
  'ukb-skill',
  'nhanes-skill',
  'mimiciii-skill',
  'mimiciv-skill',
  'mimiciv31-skill',
  'nwicu-skill',
  'eicu-skill',
  'pic-skill',
];

const replacedDatabaseSkills = databaseSkills.map((skill) => (
  `skills/${skill.replace(/-skill$/, '-database-access')}`
));

const includedPaths = [
  'package.json',
  'public/install.ps1',
  'scripts/ensure-native-modules.js',
  'server/utils/webShellMode.js',
  'skills/skills-catalog-v2.json',
  'skills/stage-skill-map.json',
  'skills/skill-tag-mapping.json',
  'skills/skill-workflow-categories.json',
  ...databaseSkills.map((skill) => `skills/${skill}`),
];

const releaseDir = path.join(rootDir, 'release');
const patchName = `medhelp-patch-${fromVersion}-to-${targetVersion}.zip`;
const patchPath = path.join(releaseDir, patchName);
const stagingDir = path.join(releaseDir, `.patch-${fromVersion}-to-${targetVersion}`);
const payloadDir = path.join(stagingDir, 'payload');

await fs.rm(stagingDir, { recursive: true, force: true });
await fs.rm(patchPath, { force: true });
await fs.rm(`${patchPath}.sha256`, { force: true });
await fs.mkdir(payloadDir, { recursive: true });

for (const relativePath of includedPaths) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(payloadDir, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true });
}

const manifest = {
  formatVersion: 1,
  product: 'medhelp',
  fromVersion,
  targetVersion,
  files: includedPaths,
  remove: replacedDatabaseSkills,
};
await fs.writeFile(
  path.join(stagingDir, 'patch-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

async function normalizeTimestamps(directoryPath) {
  const fixedTime = new Date('2000-01-01T00:00:00.000Z');
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await normalizeTimestamps(entryPath);
    }
    await fs.utimes(entryPath, fixedTime, fixedTime);
  }
  await fs.utimes(directoryPath, fixedTime, fixedTime);
}

await normalizeTimestamps(stagingDir);
execFileSync('zip', ['-X', '-q', '-r', patchPath, 'patch-manifest.json', 'payload'], {
  cwd: stagingDir,
  stdio: 'inherit',
});

const patchBytes = await fs.readFile(patchPath);
const sha256 = crypto.createHash('sha256').update(patchBytes).digest('hex');
await fs.writeFile(`${patchPath}.sha256`, `${sha256}  ${patchName}\n`, 'utf8');
await fs.rm(stagingDir, { recursive: true, force: true });

const sizeKb = Math.ceil(patchBytes.byteLength / 1024);
console.log(`${patchPath} (${sizeKb} KB)`);
console.log(`${patchPath}.sha256`);
