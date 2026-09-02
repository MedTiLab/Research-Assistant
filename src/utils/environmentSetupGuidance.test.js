import { describe, expect, it } from 'vitest';

import { getEnvironmentSetupGuidance } from './environmentSetupGuidance';

describe('environment setup guidance', () => {
  it('shows official Windows download pages and Windows paths on Windows', () => {
    const guidance = getEnvironmentSetupGuidance('win32');

    expect(guidance.pythonDownloadUrl).toBe('https://www.python.org/downloads/windows/');
    expect(guidance.rDownloadUrl).toBe('https://cran.r-project.org/bin/windows/base/');
    expect(guidance.pythonDescription).not.toContain('Package Manager');
    expect(guidance.pythonDescription).not.toContain('Add python.exe to PATH');
    expect(guidance.pythonPlaceholder).toContain('\\python.exe');
    expect(guidance.ccSwitchDescription).toContain('“开始”菜单');
  });

  it('shows official macOS download pages without command-line instructions', () => {
    const guidance = getEnvironmentSetupGuidance('darwin');

    expect(guidance.pythonDownloadUrl).toBe('https://www.python.org/downloads/macos/');
    expect(guidance.rDownloadUrl).toBe('https://cran.r-project.org/bin/macosx/');
    expect(guidance.pythonDescription).not.toContain('Homebrew');
    expect(guidance.pythonPlaceholder).toContain('/opt/homebrew/');
  });

  it('links Linux users to official installation pages', () => {
    const guidance = getEnvironmentSetupGuidance('linux');

    expect(guidance.pythonDownloadUrl).toBe('https://www.python.org/downloads/source/');
    expect(guidance.rDownloadUrl).toBe('https://cran.r-project.org/bin/linux/');
  });

  it('falls back to the official general download pages for an unknown platform', () => {
    const guidance = getEnvironmentSetupGuidance('unknown');

    expect(guidance.pythonDownloadUrl).toBe('https://www.python.org/downloads/');
    expect(guidance.rDownloadUrl).toBe('https://cran.r-project.org/');
  });
});
