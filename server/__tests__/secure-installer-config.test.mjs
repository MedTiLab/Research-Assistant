import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { getLocalKernelConfig } from '../utils/webShellMode.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_KEYS = [
  'MEDHELP_PUBLIC_URL',
  'PUBLIC_URL',
  'APP_PUBLIC_URL',
  'MEDHELP_INSTALLER_URL',
  'MEDHELP_WINDOWS_INSTALLER_URL',
  'MEDHELP_WINDOWS_NPM_PACKAGE_URL',
  'MEDHELP_MAC_NPM_PACKAGE_URL',
  'MEDHELP_KERNEL_VERSION',
  'MEDHELP_WINDOWS_KERNEL_VERSION',
  'MEDHELP_MAC_KERNEL_VERSION',
  'MEDHELP_INSTALL_COMMAND',
  'MEDHELP_WINDOWS_INSTALL_COMMAND',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('desktop-only distribution surface', () => {
  it('publishes only desktop discovery metadata to the web app', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const config = getLocalKernelConfig();

    expect(config).toEqual({
      required: false,
      discovery: 'loopback-auto',
      distribution: 'desktop-only',
      desktopDownloadPath: '/download',
    });
    expect(config).not.toHaveProperty('downloads');
    expect(config).not.toHaveProperty('installCommands');
    expect(config).not.toHaveProperty('command');
  });

  it('does not ship standalone browser Kernel installers or manifests', () => {
    expect(fs.existsSync(path.join(ROOT, 'public', 'install.sh'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'public', 'install.ps1'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'public', 'downloads', 'local-kernel-release.json'))).toBe(false);
  });

  it('keeps the legacy package implementation internal and undocumented for users', () => {
    const npmBuilder = fs.readFileSync(path.join(ROOT, 'scripts', 'packaging', 'local-engine', 'package-npm.mjs'), 'utf8');
    const npmReadme = fs.readFileSync(path.join(ROOT, 'npm', 'windows-headless', 'README.md'), 'utf8');
    const normalizedReadme = npmReadme.replace(/\r\n/g, '\n');

    expect(npmBuilder).toContain("'medhelp-kernelctl': 'bin/medhelp-kernelctl.mjs'");
    expect(npmBuilder).toContain("name: 'medhelp'");
    expect(npmBuilder).toContain("postinstall: 'node bin/medhelp-kernelctl.mjs postinstall'");
    expect(normalizedReadme).toContain('no longer publishes a standalone npm/TGZ Kernel');
    expect(normalizedReadme).not.toContain('npm install -g');
    expect(normalizedReadme).not.toContain('medhelp local-kernel start');
  });

  it('makes Windows desktop installers recover from orphaned Kernel processes and package the offline UI explicitly', () => {
    const desktopBuilder = fs.readFileSync(
      path.join(ROOT, 'scripts', 'packaging', 'windows', 'package-online-desktop.mjs'),
      'utf8',
    );
    const desktopInstaller = fs.readFileSync(
      path.join(ROOT, 'packaging', 'windows', 'online-desktop', 'installer.nsh'),
      'utf8',
    );
    const desktopProcessStopper = fs.readFileSync(
      path.join(ROOT, 'packaging', 'windows', 'online-desktop', 'stop-installed-processes.ps1'),
      'utf8',
    );
    const desktopShortcutCreator = fs.readFileSync(
      path.join(ROOT, 'packaging', 'windows', 'online-desktop', 'create-installed-shortcuts.ps1'),
      'utf8',
    );
    const desktopMain = fs.readFileSync(path.join(ROOT, 'desktop', 'online', 'main.mjs'), 'utf8');
    const desktopPreload = fs.readFileSync(path.join(ROOT, 'desktop', 'online', 'preload.mjs'), 'utf8');
    const offlineUiServer = fs.readFileSync(path.join(ROOT, 'desktop', 'online', 'offlineUiServer.mjs'), 'utf8');
    const localKernelBoundary = fs.readFileSync(
      path.join(ROOT, 'src', 'components', 'local-kernel', 'LocalKernelBoundary.tsx'),
      'utf8',
    );
    const localKernelGate = fs.readFileSync(
      path.join(ROOT, 'src', 'components', 'local-kernel', 'LocalKernelGate.tsx'),
      'utf8',
    );

    expect(desktopBuilder).toContain('perMachine: true');
    expect(desktopBuilder).toContain('const offlineUi = true');
    expect(desktopBuilder).toContain("path.join(rootDir, 'build', 'offline-desktop-app')");
    expect(desktopBuilder).toContain("main: 'desktop/offline/main.mjs'");
    expect(desktopBuilder).toContain("to: 'desktop-resource-sources.json'");
    expect(desktopBuilder).toContain('Online-only resources remain in the offline bundle');
    expect(desktopBuilder).toContain('MedHelp-${distributionLabel}-\\${version}-win-x64.\\${ext}');
    expect(desktopBuilder).toContain("createDesktopShortcut: 'always'");
    expect(desktopBuilder).toContain('createStartMenuShortcut: true');
    expect(desktopBuilder).toContain("path.join(stagingDir, 'assets', 'stop-installed-processes.ps1')");
    expect(desktopBuilder).toContain('const executableName = `MedHelp-${rootPackage.version}`');
    expect(desktopBuilder).toContain('executableName,');
    expect(desktopBuilder).toContain("'!dist/downloads/**'");
    expect(desktopBuilder).toContain('hash.update(JSON.stringify(desktopFiles))');
    expect(desktopBuilder).toContain('allowToChangeInstallationDirectory: false');
    expect(desktopBuilder).toContain('shortcutName: `MedHelp ${rootPackage.version}`');
    expect(desktopBuilder).toContain("const executableRecoveryFileName = '.medhelp-main.bin'");
    expect(desktopBuilder).toContain('afterSign: async (context) =>');
    expect(localKernelGate).toContain("fetch('/api/public-downloads'");
    expect(localKernelGate).toContain('InstallerDownloadCard');
    expect(localKernelGate).toContain('href={installer.url}');
    expect(localKernelGate).toContain('DESKTOP_INSTALLER_FALLBACKS');
    expect(localKernelGate).not.toContain('to="/download"');
    expect(localKernelGate).not.toContain('installCommands');
    expect(localKernelGate).not.toContain('CommandPill');
    expect(localKernelGate).not.toContain('medhelp local-kernel start');
    expect(desktopBuilder).toContain("path.join(stagingDir, 'assets', 'repair-installed-executable.ps1')");
    expect(desktopInstaller).toContain('!macro customCheckAppRunning');
    expect(desktopInstaller).toContain('StrCpy $INSTDIR "$PROGRAMFILES64\\MedHelp"');
    expect(desktopInstaller).toContain('ReadRegStr $R7 HKLM');
    expect(desktopInstaller).toContain('ReadRegStr $R8 HKCU');
    expect(desktopInstaller).toContain('stop-installed-processes.ps1');
    expect(desktopProcessStopper).toContain("^MedHelp-\\d+\\.\\d+\\.\\d+(?:-[0-9a-f]{10})?\\.exe$");
    expect(desktopProcessStopper).toContain('Get-CimInstance Win32_Process');
    expect(desktopProcessStopper).toContain('$process.ParentProcessId');
    expect(desktopProcessStopper).toContain('rstrtmgr.dll');
    expect(desktopProcessStopper).toContain('GetLockingProcessIds');
    expect(desktopProcessStopper).toContain("'.exe', '.dll', '.node', '.asar', '.pak', '.bin'");
    expect(desktopProcessStopper).toContain('exit 32');
    expect(desktopInstaller).toContain('CopyFiles /SILENT "$R7\\$1" "$PLUGINSDIR\\pre-uninstaller-machine.exe"');
    expect(desktopInstaller).toContain('ExecWait \'"$PLUGINSDIR\\pre-uninstaller-machine.exe" /S /KEEP_APP_DATA /allusers _?=$R7\'');
    expect(desktopInstaller).toContain('CopyFiles /SILENT "$R8\\$1" "$PLUGINSDIR\\pre-uninstaller-user.exe"');
    expect(desktopInstaller).toContain('ExecWait \'"$PLUGINSDIR\\pre-uninstaller-user.exe" /S /KEEP_APP_DATA /currentuser _?=$R8\'');
    expect(desktopInstaller).not.toContain('pre-uninstaller-machine.exe" /S /KEEP_APP_DATA /allusers --updated');
    expect(desktopInstaller).toContain('SetErrorLevel 4');
    expect(desktopInstaller).toContain('Delete "$DESKTOP\\MedHelp *.lnk"');
    expect(desktopInstaller).toContain('create-installed-shortcuts.ps1');
    expect(desktopInstaller).toContain('CopyFiles /SILENT "$INSTDIR\\resources\\.medhelp-main.bin" "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"');
    expect(desktopInstaller).toContain('File /oname=.medhelp-executable-repair.ps1');
    expect(desktopInstaller).toContain('-File "$INSTDIR\\resources\\.medhelp-executable-repair.ps1"');
    expect(desktopInstaller).toContain('-RecoveryPath "$INSTDIR\\resources\\.medhelp-main.bin"');
    expect(desktopInstaller).toContain('SetErrorLevel 3');
    expect(desktopShortcutCreator).toContain("GetFolderPath('CommonDesktopDirectory')");
    expect(desktopShortcutCreator).toContain("GetFolderPath('CommonPrograms')");
    expect(desktopShortcutCreator).toContain('$shortcut.Save()');
    expect(desktopShortcutCreator).toContain('Shortcut target mismatch');
    expect(desktopInstaller).toContain('$INSTDIR\\MedHelp.exe');
    expect(desktopInstaller).toContain('SetErrorLevel 2');
    expect(desktopMain).toContain("spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F']");
    expect(desktopMain).toContain('signal: AbortSignal.timeout(2_500)');
    expect(desktopMain).toContain("fs.existsSync(shortcutPath) ? 'replace' : 'create'");
    expect(desktopMain).toContain('versionedShortcutPattern.test(entry.name)');
    expect(desktopMain).toContain('shell.writeShortcutLink(shortcutPath, operation, options)');
    expect(desktopMain).toContain("app.getPath('desktop')");
    expect(desktopMain).toContain('app.setLoginItemSettings({');
    expect(desktopMain).toContain('setTimeout(ensureWindowsLaunchShortcuts, 15_000).unref()');
    expect(desktopMain).toContain('safeStorage.encryptString');
    expect(desktopMain).toContain('isTrustedHostedRenderer(event)');
    expect(desktopPreload).toContain('记住账号和密码（仅保存在本机）');
    expect(desktopPreload).toContain('installDesktopLoginMemory(usernameInput);');
    expect(desktopPreload).toContain("ipcRenderer.invoke('desktop:is-main-window-visible')");
    expect(desktopMain).toContain('canReadRememberedLogin({');
    expect(desktopPreload).toContain("=== 'offline' ? 'offline' : 'hosted'");
    expect(desktopPreload).toContain('shouldUseKeychainAuthSession(desktopUiMode)');
    expect(desktopMain).toContain('shouldUseKeychainAuthSession(DESKTOP_UI_MODE)');
    expect(desktopMain).toContain('Hosted UI is still initializing; showing the loaded app');
    expect(desktopMain).toContain('resolveHostedUiTimeout({');
    expect(desktopMain).not.toContain('本地引擎连接失败');
    expect(desktopMain).not.toContain('本地服务未能在 20 秒内完成连接');
    expect(desktopPreload).not.toContain('synchronizeDesktopKernelTransition()');
    expect(desktopPreload).not.toContain('medhelp-online-desktop-login-transition');
    expect(offlineUiServer).toContain('DEFAULT_OFFLINE_UI_PORT = 43118');
    expect(offlineUiServer).toContain("server.listen(listenPort, '127.0.0.1'");
    expect(localKernelBoundary).toContain('正在进入工作台…');
    expect(localKernelBoundary).toContain('runtime.isDesktopKernel');
    expect(localKernelBoundary).toContain('if (runtime.isDesktopShell)');
    expect(localKernelBoundary).toContain('return <>{children}</>;');
    expect(localKernelBoundary).toContain('shouldShowDesktopKernelTransition(state)');
    expect(localKernelBoundary).toContain('return <LocalKernelGate />');
    expect(desktopMain).toContain("data-medhelp-initial-setup");
    expect(desktopMain).toContain('initialSetupVisible');
  });

  it('exposes only bundled-frontend desktop build commands', () => {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const scripts = rootPackage.scripts;
    const windowsVerifier = fs.readFileSync(
      path.join(ROOT, 'scripts', 'packaging', 'windows', 'verify-local-release.ps1'),
      'utf8',
    );

    expect(scripts['desktop:start']).toBe('npm run desktop:offline:start');
    expect(scripts['desktop:dist:mac']).toBe('npm run desktop:offline:dist:mac');
    expect(scripts['desktop:dist:win']).toBe('npm run desktop:offline:dist:win');
    expect(scripts['desktop:offline:dist:win']).toContain('package-online-desktop.mjs');
    expect(scripts['desktop:offline:dist:win']).not.toContain('--offline');
    expect(scripts['release:local:win']).toBe('npm run desktop:offline:dist:win');
    expect(scripts['release:local:offline:win']).toBe('npm run desktop:offline:dist:win');
    expect(scripts['release:verify:local:offline:win']).toContain('-Distribution Offline');
    expect(windowsVerifier).toContain("[string] $Distribution = 'Offline'");
    expect(windowsVerifier).not.toContain('medhelp-kernel-win32-x64');
    expect(windowsVerifier).not.toContain('$tgzPath');
    expect(Object.keys(scripts).filter((name) => name.startsWith('kernel:headless'))).toEqual([]);
    expect(Object.keys(scripts).filter((name) => /^local-engine:(npm|dist|patch)/.test(name))).toEqual([]);
    expect(scripts).not.toHaveProperty('desktop:online:dist:mac');
    expect(scripts).not.toHaveProperty('desktop:online:dist:win');
    expect(scripts).not.toHaveProperty('desktop:legacy:start');
    expect(scripts['kernel:dist:mac']).toBeUndefined();
    expect(scripts['kernel:dist:win']).toBeUndefined();
    expect(fs.existsSync(path.join(ROOT, 'electron-builder.kernel.yml'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'desktop', 'local-kernel-main.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'package-local-kernel-mac.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, '.github', 'workflows', 'desktop.yml'))).toBe(false);
  });

  it('requires the bundled skill set to match the source catalog dynamically', () => {
    const kernelBuilder = fs.readFileSync(
      path.join(ROOT, 'scripts', 'build-secure-headless-kernel.mjs'),
      'utf8',
    );

    expect(kernelBuilder).toContain('bundledSkillCount !== sourceSkillCount');
    expect(kernelBuilder).not.toMatch(/bundledSkillCount\s*!==\s*196/);
    expect(kernelBuilder).not.toContain('nonBundledSkillRoots');
  });

  it('does not keep an independent Kernel release workflow', () => {
    expect(fs.existsSync(path.join(ROOT, '.github', 'workflows', 'kernel-installers.yml'))).toBe(false);
  });
});
