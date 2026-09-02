import { describe, expect, it } from 'vitest';

import {
  isNewerVersion,
  normalizeLocalKernelRelease,
  parseVersionParts,
  resolveKernelInstallCommand,
  resolveKernelDownloadUrl,
  resolveKernelReleasePlatform,
} from './useLocalKernelUpdateCheck';

describe('useLocalKernelUpdateCheck helpers', () => {
  it('parses and compares semantic versions', () => {
    expect(parseVersionParts('v1.2.3')).toEqual([1, 2, 3]);
    expect(isNewerVersion('1.2.4', '1.2.3')).toBe(true);
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.2', '1.2.3')).toBe(false);
    expect(isNewerVersion('not-a-version', '1.2.3')).toBe(false);
  });

  it('chooses the platform-specific Kernel download when possible', () => {
    const downloads = {
      installer: 'https://app.medtimehelp.com/install.sh',
      mac: 'https://app.medtimehelp.com/MedHelp-mac.dmg',
      win: 'https://app.medtimehelp.com/MedHelp-win.exe',
    };

    expect(resolveKernelDownloadUrl(downloads, 'MacIntel')).toBe(downloads.mac);
    expect(resolveKernelDownloadUrl(downloads, 'Win32')).toBe(downloads.win);
    expect(resolveKernelDownloadUrl(downloads, 'Linux x86_64')).toBe(downloads.installer);
  });

  it('maps browser platforms to release channels', () => {
    expect(resolveKernelReleasePlatform('MacIntel')).toBe('mac');
    expect(resolveKernelReleasePlatform('Win32')).toBe('windows');
    expect(resolveKernelReleasePlatform('Linux x86_64')).toBe('');
  });

  it('normalizes a Kernel release payload for the sidebar modal', () => {
    const release = normalizeLocalKernelRelease({
      product: 'MedHelp Kernel',
      version: 'v1.3.0',
      downloads: { installer: 'https://app.medtimehelp.com/install.sh' },
      installCommand: 'curl -fsSL https://app.medtimehelp.com/install.sh | sh',
    }, null, 'Linux');

    expect(release.version).toBe('1.3.0');
    expect(release.releaseInfo?.title).toBe('MedHelp Local Engine v1.3.0');
    expect(release.downloadUrl).toBe('https://app.medtimehelp.com/install.sh');
    expect(release.upgradeCommand).toBe('curl -fsSL https://app.medtimehelp.com/install.sh | sh');
  });

  it('chooses the platform-specific Kernel install command when possible', () => {
    const payload = {
      installCommand: 'curl -fsSL https://app.medtimehelp.com/install.sh | sh',
      installCommands: {
        default: 'curl -fsSL https://app.medtimehelp.com/install.sh | sh',
        windows: 'npm install -g --force --progress=true https://app.medtimehelp.com/downloads/medhelp-cli-1.1.8.tgz',
      },
    };

    expect(resolveKernelInstallCommand(payload, 'Win32')).toBe('npm install -g --force --progress=true https://app.medtimehelp.com/downloads/medhelp-cli-1.1.8.tgz');
    expect(resolveKernelInstallCommand(payload, 'MacIntel')).toBe('curl -fsSL https://app.medtimehelp.com/install.sh | sh');
  });
});
