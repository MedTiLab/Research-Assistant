import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(MODULE_DIR, '../..');
const DEFAULT_MANIFEST_PATH = path.join(APP_ROOT, 'dist', 'downloads', 'local-kernel-release.json');

function normalizePublicBaseUrl(value) {
  return String(value || 'https://app.medtimehelp.com').trim().replace(/\/+$/, '');
}

export function readKernelReleaseManifest(manifestPath = process.env.MEDHELP_KERNEL_RELEASE_MANIFEST || DEFAULT_MANIFEST_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const version = String(parsed?.version || '').trim();
    const windows = parsed?.windows;
    const packageName = String(windows?.package || '').trim();
    const sha256 = String(windows?.sha256 || '').trim().toLowerCase();
    const signature = String(windows?.signature || '').trim();
    const bytes = Number(windows?.bytes);
    const mac = parsed?.mac;
    const macVersion = String(mac?.version || '').trim();
    const macPackageName = String(mac?.package || '').trim();
    const macSha256 = String(mac?.sha256 || '').trim().toLowerCase();
    const macBytes = Number(mac?.bytes);

    if (
      parsed?.schemaVersion !== 1
      || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
      || !/^medhelp-kernel-win32-x64-[0-9A-Za-z._+-]+\.tgz$/.test(packageName)
      || !/^[a-f0-9]{64}$/.test(sha256)
      || !signature
      || !Number.isSafeInteger(bytes)
      || bytes <= 0
    ) {
      return null;
    }

    if (mac && (
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(macVersion)
      || !/^medhelp-kernel-darwin-arm64-[0-9A-Za-z._+-]+\.tgz$/.test(macPackageName)
      || !/^[a-f0-9]{64}$/.test(macSha256)
      || !Number.isSafeInteger(macBytes)
      || macBytes <= 0
    )) {
      return null;
    }

    return {
      schemaVersion: 1,
      product: String(parsed.product || 'MedHelp Local Engine'),
      version,
      publishedAt: String(parsed.publishedAt || ''),
      notes: String(parsed.notes || ''),
      windows: {
        package: packageName,
        sha256,
        signature,
        signatureAlgorithm: 'ed25519-sha256',
        bytes,
      },
      ...(mac ? {
        mac: {
          version: macVersion,
          package: macPackageName,
          sha256: macSha256,
          bytes: macBytes,
          publishedAt: String(mac.publishedAt || parsed.publishedAt || ''),
          notes: String(mac.notes || parsed.notes || ''),
        },
      } : {}),
    };
  } catch {
    return null;
  }
}

export function resolvePublishedMacKernelUpdate(publicUrl, manifest = readKernelReleaseManifest()) {
  if (!manifest?.mac) {
    return null;
  }
  const baseUrl = normalizePublicBaseUrl(publicUrl);
  return {
    version: manifest.mac.version,
    packageUrl: `${baseUrl}/downloads/${encodeURIComponent(manifest.mac.package)}`,
    sha256: manifest.mac.sha256,
    bytes: manifest.mac.bytes,
    publishedAt: manifest.mac.publishedAt,
    notes: manifest.mac.notes,
  };
}

export function resolvePublishedWindowsKernelUpdate(publicUrl, manifest = readKernelReleaseManifest()) {
  if (!manifest?.windows) {
    return null;
  }
  const baseUrl = normalizePublicBaseUrl(publicUrl);
  return {
    version: manifest.version,
    packageUrl: `${baseUrl}/downloads/${encodeURIComponent(manifest.windows.package)}`,
    sha256: manifest.windows.sha256,
    signature: manifest.windows.signature,
    signatureAlgorithm: manifest.windows.signatureAlgorithm,
    bytes: manifest.windows.bytes,
    publishedAt: manifest.publishedAt,
    notes: manifest.notes,
  };
}
