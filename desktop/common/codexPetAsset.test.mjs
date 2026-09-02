import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CODEX_PET_ATLAS, inspectPetImage, loadCodexPetAsset } from './codexPetAsset.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function createPetDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pet-test-'));
  temporaryDirectories.push(directory);
  const spritesheet = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(spritesheet, 0);
  Buffer.from('IHDR').copy(spritesheet, 12);
  spritesheet.writeUInt32BE(CODEX_PET_ATLAS.width, 16);
  spritesheet.writeUInt32BE(CODEX_PET_ATLAS.height, 20);
  await fs.writeFile(path.join(directory, 'pet.png'), spritesheet);
  await fs.writeFile(path.join(directory, 'pet.json'), JSON.stringify({
    id: 'test-pet',
    displayName: 'Test Pet',
    spriteVersionNumber: 2,
    spritesheetPath: 'pet.png',
  }));
  return directory;
}

describe('Codex pet asset inspection', () => {
  it('reads PNG dimensions without decoding the image', () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
    Buffer.from('IHDR').copy(bytes, 12);
    bytes.writeUInt32BE(CODEX_PET_ATLAS.width, 16);
    bytes.writeUInt32BE(CODEX_PET_ATLAS.height, 20);

    expect(inspectPetImage(bytes)).toEqual({
      mimeType: 'image/png',
      width: 1536,
      height: 2288,
    });
  });

  it('rejects unknown image bytes', () => {
    expect(inspectPetImage(Buffer.from('not-an-image'))).toBeNull();
  });

  it('loads a compatible Codex v2 pet directory', async () => {
    const directory = await createPetDirectory();
    const asset = await loadCodexPetAsset(directory);
    expect(asset).toMatchObject({ id: 'test-pet', displayName: 'Test Pet', spriteVersionNumber: 2 });
    expect(asset.spritesheetDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(asset.frameCounts.idle).toBe(7);
  });
});
