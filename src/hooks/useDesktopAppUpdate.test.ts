import { describe, expect, it } from 'vitest';

import { desktopCatalogFromGitHub, DESKTOP_RELEASE_API, DESKTOP_RELEASE_REPOSITORY, selectDesktopDownloadArtifact } from './useDesktopAppUpdate';

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


describe('GitHub desktop update source', () => {
  it('uses the current repository and release assets instead of the legacy catalog', () => {
    expect(DESKTOP_RELEASE_API).toBe('https://api.github.com/repos/MedTiLab/Research-Assistant/releases/latest');
    const catalog = desktopCatalogFromGitHub({
      tag_name: 'v0.2.0',
      assets: [
        { name: 'medhelpsec-0.2.0-mac-arm64.dmg', browser_download_url: `${DESKTOP_RELEASE_REPOSITORY}/releases/download/v0.2.0/medhelpsec.dmg` },
        { name: 'source.zip', browser_download_url: `${DESKTOP_RELEASE_REPOSITORY}/archive/v0.2.0.zip` },
        { name: 'MedHelp-Offline-1.1.19-win-x64.exe', browser_download_url: '/api/public-downloads/object/downloads/old.exe' },
      ],
    });
    expect(catalog.medhelpDesktop).toHaveLength(1);
    expect(selectDesktopDownloadArtifact(catalog, 'darwin')?.version).toBe('0.2.0');
    expect(selectDesktopDownloadArtifact(catalog, 'win32')).toBeNull();
  });

  it('does not invent an update without a stable release and installer', () => {
    for (const release of [{}, { tag_name: 'v0.2.0' }, { tag_name: 'v0.2.0', draft: true }, { tag_name: 'v0.2.0-beta' }]) {
      expect(desktopCatalogFromGitHub(release).medhelpDesktop).toEqual([]);
    }
  });
});
