import fs from 'node:fs/promises';
import path from 'node:path';

export const CODEX_PET_ATLAS = Object.freeze({
  width: 1536,
  height: 2288,
  columns: 8,
  rows: 11,
});

export const DEFAULT_CODEX_PET_FRAME_COUNTS = Object.freeze({
  idle: 7,
  'running-right': 8,
  'running-left': 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6,
  'look-000-to-157.5': 8,
  'look-180-to-337.5': 8,
});

const MAX_SPRITESHEET_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;

function readU24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

export function inspectPetImage(bytes) {
  if (
    bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.subarray(12, 16).toString('ascii') === 'IHDR'
  ) {
    return {
      mimeType: 'image/png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }

  if (
    bytes.length >= 20
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.subarray(offset, offset + 4).toString('ascii');
      const size = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      const end = start + size;
      if (end > bytes.length) return null;
      if (kind === 'VP8X' && size >= 10) {
        return {
          mimeType: 'image/webp',
          width: readU24LE(bytes, start + 4) + 1,
          height: readU24LE(bytes, start + 7) + 1,
        };
      }
      if (kind === 'VP8 ' && size >= 10 && bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
        return {
          mimeType: 'image/webp',
          width: bytes.readUInt16LE(start + 6) & 0x3fff,
          height: bytes.readUInt16LE(start + 8) & 0x3fff,
        };
      }
      if (kind === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
        const bits = bytes.readUInt32LE(start + 1);
        return {
          mimeType: 'image/webp',
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1,
        };
      }
      offset = end + (size & 1);
    }
  }

  return null;
}

async function readSmallJson(filePath, required = true) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.size > MAX_JSON_BYTES) {
    throw new Error(`${path.basename(filePath)} must be a JSON file smaller than 1 MB.`);
  }
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function frameCountsFromValidation(validation) {
  if (!validation) return { ...DEFAULT_CODEX_PET_FRAME_COUNTS };
  if (
    validation.ok !== true
    || validation.columns !== CODEX_PET_ATLAS.columns
    || validation.rows !== CODEX_PET_ATLAS.rows
    || validation.width !== CODEX_PET_ATLAS.width
    || validation.height !== CODEX_PET_ATLAS.height
    || !Array.isArray(validation.cells)
  ) {
    throw new Error('validation.json does not describe a valid Codex v2 8x11 atlas.');
  }

  const counts = { ...DEFAULT_CODEX_PET_FRAME_COUNTS };
  for (const state of Object.keys(counts)) {
    const usedColumns = validation.cells
      .filter((cell) => cell?.state === state && cell?.used === true && Number.isInteger(cell?.column))
      .map((cell) => cell.column);
    if (usedColumns.length > 0) counts[state] = Math.max(1, Math.min(8, Math.max(...usedColumns) + 1));
  }
  return counts;
}

export async function loadCodexPetAsset(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('Pet directory must be an absolute path.');
  }
  const root = await fs.realpath(directory);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new Error('Pet path is not a directory.');

  const manifest = await readSmallJson(path.join(root, 'pet.json'));
  if (!String(manifest?.id || '').trim() || !String(manifest?.displayName || '').trim()) {
    throw new Error('pet.json requires id and displayName.');
  }
  if (manifest.spriteVersionNumber !== 2) {
    throw new Error('Only spriteVersionNumber 2 pets are supported.');
  }

  const relativeSpritesheet = String(manifest.spritesheetPath || '').trim();
  if (!relativeSpritesheet || path.isAbsolute(relativeSpritesheet)) {
    throw new Error('spritesheetPath must be a relative file path.');
  }
  const spritesheetPath = await fs.realpath(path.join(root, relativeSpritesheet));
  const relativeResolvedPath = path.relative(root, spritesheetPath);
  if (relativeResolvedPath.startsWith('..') || path.isAbsolute(relativeResolvedPath)) {
    throw new Error('spritesheetPath must stay inside the pet directory.');
  }

  const stat = await fs.stat(spritesheetPath);
  if (!stat.isFile() || stat.size > MAX_SPRITESHEET_BYTES) {
    throw new Error('Pet spritesheet must be a file no larger than 16 MB.');
  }
  const bytes = await fs.readFile(spritesheetPath);
  const image = inspectPetImage(bytes);
  if (!image) throw new Error('Pet spritesheet must be a valid PNG or WebP image.');
  if (image.width !== CODEX_PET_ATLAS.width || image.height !== CODEX_PET_ATLAS.height) {
    throw new Error(`Pet spritesheet must be ${CODEX_PET_ATLAS.width}x${CODEX_PET_ATLAS.height}; found ${image.width}x${image.height}.`);
  }

  const validation = await readSmallJson(path.join(root, 'validation.json'), false);
  return {
    id: String(manifest.id).trim(),
    displayName: String(manifest.displayName).trim(),
    description: String(manifest.description || '').trim(),
    spriteVersionNumber: 2,
    spritesheetDataUrl: `data:${image.mimeType};base64,${bytes.toString('base64')}`,
    frameCounts: frameCountsFromValidation(validation),
  };
}
