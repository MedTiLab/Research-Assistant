import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPublicDownloadCatalog,
  resolvePublicDownloadObject,
} from '../utils/publicDownloads.js';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('public download catalog', () => {
  it('lists the Windows and macOS installers and only downloadable CC Switch artifacts', () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-downloads-'));
    temporaryDirectories.push(publicDir);
    const downloadsDir = path.join(publicDir, 'downloads');
    const ccSwitchDir = path.join(downloadsDir, 'cc-switch');
    fs.mkdirSync(ccSwitchDir, { recursive: true });

    fs.writeFileSync(path.join(downloadsDir, 'MedHelp-Offline-1.1.19-win-x64.exe'), 'installer');
    fs.writeFileSync(path.join(downloadsDir, 'MedHelp-Offline-1.1.19-mac-arm64.dmg'), 'mac installer');
    fs.writeFileSync(
      path.join(downloadsDir, 'MedHelp-Offline-1.1.19-win-x64.exe.sha256'),
      `${'a'.repeat(64)}  MedHelp-Offline-1.1.19-win-x64.exe\n`,
    );
    fs.writeFileSync(
      path.join(downloadsDir, 'MedHelp-Offline-1.1.19-mac-arm64.dmg.sha256'),
      `${'b'.repeat(64)}  MedHelp-Offline-1.1.19-mac-arm64.dmg\n`,
    );
    fs.writeFileSync(path.join(ccSwitchDir, 'CC-Switch-v3.17.0-Windows.msi'), 'windows');
    fs.writeFileSync(path.join(ccSwitchDir, 'CC-Switch-v3.17.0-macOS.dmg'), 'mac');
    fs.writeFileSync(path.join(ccSwitchDir, 'CC-Switch-v3.17.0-Linux-x86_64.AppImage'), 'linux');
    fs.writeFileSync(path.join(ccSwitchDir, 'notes.txt'), 'not public');

    const catalog = buildPublicDownloadCatalog(publicDir);

    expect(catalog.medhelp).toMatchObject({
      name: 'MedHelp-Offline-1.1.19-win-x64.exe',
      url: '/api/public-downloads/object/downloads/MedHelp-Offline-1.1.19-win-x64.exe',
      sha256: 'a'.repeat(64),
      product: 'MedHelp Offline',
      platform: 'windows',
      architecture: 'x64',
      version: '1.1.19',
    });
    expect(catalog.medhelpDesktop).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: 'windows', architecture: 'x64' }),
      expect.objectContaining({
        name: 'MedHelp-Offline-1.1.19-mac-arm64.dmg',
        sha256: 'b'.repeat(64),
        product: 'MedHelp Offline',
        platform: 'macos',
        architecture: 'arm64',
        version: '1.1.19',
      }),
    ]));
    expect(catalog.ccSwitch).toHaveLength(3);
    expect(catalog.ccSwitch.map((item) => item.platform)).toEqual(['linux', 'macos', 'windows']);
    expect(catalog.ccSwitch.map((item) => item.architecture)).toEqual(['x64', 'universal', 'x64']);
    expect(catalog.ccSwitch.map((item) => item.version)).toEqual(['3.17.0', '3.17.0', '3.17.0']);
    expect(JSON.stringify(catalog)).not.toContain('notes.txt');
    expect(resolvePublicDownloadObject(
      publicDir,
      'downloads/cc-switch/CC-Switch-v3.17.0-Windows.msi',
    )).toEqual({
      objectKey: 'downloads/cc-switch/CC-Switch-v3.17.0-Windows.msi',
    });
    expect(resolvePublicDownloadObject(publicDir, 'downloads/private.txt')).toBeNull();
  });

  it('uses verified COS metadata when local installer files are absent', () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-downloads-'));
    temporaryDirectories.push(publicDir);

    expect(buildPublicDownloadCatalog(publicDir)).toMatchObject({
      medhelp: {
        name: 'MedHelp-Offline-1.1.19-win-x64.exe',
        bytes: 435078525,
        sha256: '8cfccbf251f3c48dfa44668ebed5f68e48a5e186966e108d6c78a8f358f78085',
      },
      medhelpDesktop: [
        expect.objectContaining({ platform: 'windows', product: 'MedHelp Offline', version: '1.1.19' }),
        expect.objectContaining({
          platform: 'macos',
          product: 'MedHelp Offline',
          version: '1.1.19',
          bytes: 439891490,
          sha256: '8309c733fe237749b2325b1dffbb36c4a7b353b35c3325ea583552561b373227',
        }),
      ],
      ccSwitch: [],
    });
    expect(resolvePublicDownloadObject(
      publicDir,
      'downloads/MedHelp-Offline-1.1.19-win-x64.exe',
    )).toEqual({ objectKey: 'downloads/MedHelp-Offline-1.1.19-win-x64.exe' });
    expect(resolvePublicDownloadObject(
      publicDir,
      'downloads/MedHelp-Offline-1.1.19-mac-arm64.dmg',
    )).toEqual({ objectKey: 'downloads/MedHelp-Offline-1.1.19-mac-arm64.dmg' });
  });
});
