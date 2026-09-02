import { describe, expect, it } from 'vitest';

import { selectDesktopDownloadArtifact } from './useDesktopAppUpdate';

describe('desktop app update catalog selection', () => {
  const catalog = {
    medhelpDesktop: [
      {
        name: 'MedHelp-Online-1.1.15-win-x64.exe',
        url: '/api/public-downloads/object/downloads/MedHelp-Online-1.1.15-win-x64.exe',
        platform: 'windows',
        architecture: 'x64',
        version: '1.1.15',
      },
      {
        name: 'MedHelp-Offline-1.1.18-mac-arm64.dmg',
        url: '/api/public-downloads/object/downloads/MedHelp-Offline-1.1.18-mac-arm64.dmg',
        platform: 'macos',
        architecture: 'arm64',
        version: '1.1.18',
      },
    ],
  };

  it('selects the DMG for a legacy macOS desktop shell', () => {
    const artifact = selectDesktopDownloadArtifact(catalog, 'darwin');

    expect(artifact?.name).toBe('MedHelp-Offline-1.1.18-mac-arm64.dmg');
    expect(artifact?.url).toContain('.dmg');
  });

  it('selects the EXE for a legacy Windows desktop shell', () => {
    const artifact = selectDesktopDownloadArtifact(catalog, 'win32');

    expect(artifact?.name).toBe('MedHelp-Online-1.1.15-win-x64.exe');
    expect(artifact?.url).toContain('.exe');
  });

  it('does not fall back to a Kernel or a different desktop platform', () => {
    expect(selectDesktopDownloadArtifact(catalog, 'linux')).toBeNull();
  });
});
