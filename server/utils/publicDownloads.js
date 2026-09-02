import fs from 'fs';
import path from 'path';

const MEDHELP_WINDOWS_INSTALLER = 'MedHelp-Offline-1.1.19-win-x64.exe';
const MEDHELP_MAC_INSTALLER = 'MedHelp-Offline-1.1.19-mac-arm64.dmg';
const FIXED_MEDHELP_RELEASES = Object.freeze({
  windows: {
    name: MEDHELP_WINDOWS_INSTALLER,
    bytes: 435078525,
    sha256: '8cfccbf251f3c48dfa44668ebed5f68e48a5e186966e108d6c78a8f358f78085',
    platform: 'windows',
    architecture: 'x64',
  },
  macos: {
    name: MEDHELP_MAC_INSTALLER,
    bytes: 439891490,
    sha256: '8309c733fe237749b2325b1dffbb36c4a7b353b35c3325ea583552561b373227',
    platform: 'macos',
    architecture: 'arm64',
  },
});
const FIXED_MEDHELP_OBJECT_KEYS = new Set([
  `downloads/${MEDHELP_WINDOWS_INSTALLER}`,
  `downloads/${MEDHELP_MAC_INSTALLER}`,
]);
const DOWNLOAD_EXTENSIONS = [
  '.appimage',
  '.deb',
  '.dmg',
  '.exe',
  '.msi',
  '.rpm',
  '.tar.gz',
  '.zip',
];

function publicCosDownloadUrl(objectKey) {
  return `/api/public-downloads/object/${objectKey.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function inferPlatform(fileName) {
  const normalized = fileName.toLowerCase();
  if (normalized.includes('windows') || normalized.endsWith('.exe') || normalized.endsWith('.msi')) {
    return 'windows';
  }
  if (normalized.includes('macos') || normalized.includes('darwin') || normalized.endsWith('.dmg')) {
    return 'macos';
  }
  if (
    normalized.includes('linux')
    || normalized.endsWith('.appimage')
    || normalized.endsWith('.deb')
    || normalized.endsWith('.rpm')
  ) {
    return 'linux';
  }
  return 'other';
}

function inferArchitecture(fileName) {
  const normalized = fileName.toLowerCase();
  if (normalized.includes('arm64') || normalized.includes('aarch64')) return 'arm64';
  if (normalized.includes('x86_64') || normalized.includes('x64') || normalized.includes('amd64')) return 'x64';
  if (normalized.includes('universal')) return 'universal';
  if (normalized.includes('windows')) return 'x64';
  if (normalized.includes('macos')) return 'universal';
  return null;
}

function inferVersion(fileName) {
  return fileName.match(/(?:^|[-_])v?(\d+\.\d+(?:\.\d+)?)(?:[-_.]|$)/i)?.[1] || null;
}

function isDownloadArtifact(fileName) {
  const normalized = fileName.toLowerCase();
  return DOWNLOAD_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function readSha256(sidecarPath) {
  try {
    const value = fs.readFileSync(sidecarPath, 'utf8').trim().split(/\s+/)[0];
    return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

function fileMetadata(filePath, objectKey, extra = {}) {
  const stat = fs.statSync(filePath);
  const sha256Path = `${filePath}.sha256`;
  return {
    name: path.basename(filePath),
    url: publicCosDownloadUrl(objectKey),
    objectKey,
    bytes: stat.size,
    sha256: readSha256(sha256Path),
    sha256Url: fs.existsSync(sha256Path) ? publicCosDownloadUrl(`${objectKey}.sha256`) : null,
    ...extra,
  };
}

function fixedReleaseMetadata(release) {
  const objectKey = `downloads/${release.name}`;
  return {
    name: release.name,
    url: publicCosDownloadUrl(objectKey),
    objectKey,
    bytes: release.bytes,
    sha256: release.sha256,
    sha256Url: publicCosDownloadUrl(`${objectKey}.sha256`),
    product: 'MedHelp Offline',
    platform: release.platform,
    architecture: release.architecture,
    version: inferVersion(release.name),
  };
}

export function buildPublicDownloadCatalog(publicDir) {
  const downloadsDir = path.join(publicDir, 'downloads');
  const medhelpPath = path.join(downloadsDir, MEDHELP_WINDOWS_INSTALLER);
  const medhelp = fs.existsSync(medhelpPath)
    ? fileMetadata(medhelpPath, `downloads/${MEDHELP_WINDOWS_INSTALLER}`, {
        product: 'MedHelp Offline',
        platform: 'windows',
        architecture: 'x64',
        version: inferVersion(MEDHELP_WINDOWS_INSTALLER),
      })
    : fixedReleaseMetadata(FIXED_MEDHELP_RELEASES.windows);
  const medhelpMacPath = path.join(downloadsDir, MEDHELP_MAC_INSTALLER);
  const medhelpMac = fs.existsSync(medhelpMacPath)
    ? fileMetadata(medhelpMacPath, `downloads/${MEDHELP_MAC_INSTALLER}`, {
        product: 'MedHelp Offline',
        platform: 'macos',
        architecture: 'arm64',
        version: inferVersion(MEDHELP_MAC_INSTALLER),
      })
    : fixedReleaseMetadata(FIXED_MEDHELP_RELEASES.macos);

  const ccSwitchDir = path.join(downloadsDir, 'cc-switch');
  let ccSwitch = [];
  try {
    ccSwitch = fs.readdirSync(ccSwitchDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isDownloadArtifact(entry.name))
      .map((entry) => fileMetadata(
        path.join(ccSwitchDir, entry.name),
        `downloads/cc-switch/${entry.name}`,
        {
          product: 'CC Switch',
          platform: inferPlatform(entry.name),
          architecture: inferArchitecture(entry.name),
          version: inferVersion(entry.name),
        },
      ))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return {
    generatedAt: new Date().toISOString(),
    medhelp,
    medhelpDesktop: [medhelp, medhelpMac].filter(Boolean),
    ccSwitch,
  };
}

export function resolvePublicDownloadObject(publicDir, requestedObjectKey) {
  if (FIXED_MEDHELP_OBJECT_KEYS.has(requestedObjectKey)) {
    return { objectKey: requestedObjectKey };
  }
  if (requestedObjectKey.endsWith('.sha256') && FIXED_MEDHELP_OBJECT_KEYS.has(requestedObjectKey.slice(0, -7))) {
    return { objectKey: requestedObjectKey };
  }
  const catalog = buildPublicDownloadCatalog(publicDir);
  const artifacts = [...catalog.medhelpDesktop, ...catalog.ccSwitch].filter(Boolean);
  for (const artifact of artifacts) {
    if (artifact.objectKey === requestedObjectKey) {
      return {
        objectKey: artifact.objectKey,
      };
    }
    if (artifact.sha256Url && `${artifact.objectKey}.sha256` === requestedObjectKey) {
      return {
        objectKey: `${artifact.objectKey}.sha256`,
      };
    }
  }
  return null;
}
