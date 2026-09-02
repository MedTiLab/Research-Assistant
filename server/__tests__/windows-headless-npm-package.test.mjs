import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acquireStartLock,
  ensureNativeRuntimeDependencies,
  main,
  openCloudApp,
  resolveLogPath,
  resolveStartLockPath,
  verifyRuntimePackage,
  verifyAgentExecutables,
} from '../../npm/windows-headless/cli.mjs';
import { buildWindowsHeadlessNpmPackage } from '../../scripts/packaging/local-engine/package-npm.mjs';

const temporaryRoots = [];

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function createWindowsRuntime(root, version = '1.1.10') {
  const runtimeRoot = path.join(root, 'runtime-source');
  const kernelEntryBytes = Buffer.from('compiled-windows-kernel-bundle');
  const nodeBytes = Buffer.from('isolated-windows-node-runtime');
  await fs.mkdir(path.join(runtimeRoot, 'bin'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', '@openai', 'codex'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', 'bcrypt'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'dist'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'fonts'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', 'pdfkit', 'js', 'data'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', 'js-md5', 'src'), { recursive: true });
  await fs.writeFile(path.join(runtimeRoot, 'kernel-entry.cjs'), kernelEntryBytes);
  await fs.writeFile(path.join(runtimeRoot, 'bin', 'node.exe'), nodeBytes);
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
    '{"name":"@anthropic-ai/claude-agent-sdk","version":"0.3.220"}\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@openai', 'codex', 'package.json'),
    '{"name":"@openai/codex","version":"0.146.0"}\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', 'bcrypt', 'package.json'),
    '{"name":"bcrypt","version":"6.0.0"}\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'package.json'),
    '{"name":"@embedpdf/fonts-sc","version":"1.0.0"}\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'dist', 'index.cjs'),
    'module.exports = {};\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'fonts', 'NotoSansHans-Regular.otf'),
    'font',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'fonts', 'NotoSansHans-Bold.otf'),
    'bold-font',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', 'pdfkit', 'package.json'),
    '{"name":"pdfkit","version":"0.19.1","dependencies":{"js-md5":"^0.8.3"}}\n',
  );
  await fs.writeFile(path.join(runtimeRoot, 'node_modules', 'pdfkit', 'js', 'data', 'Helvetica.afm'), 'helvetica');
  await fs.writeFile(path.join(runtimeRoot, 'node_modules', 'pdfkit', 'js', 'data', 'Courier.afm'), 'courier');
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', 'js-md5', 'package.json'),
    '{"name":"js-md5","version":"0.8.3","main":"src/md5.js"}\n',
  );
  await fs.writeFile(path.join(runtimeRoot, 'node_modules', 'js-md5', 'src', 'md5.js'), 'module.exports = {};\n');
  await fs.mkdir(path.join(runtimeRoot, 'skills', 'medhelp-example'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'skills', 'category', 'nested-example'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'templates'), { recursive: true });
  await fs.writeFile(
    path.join(runtimeRoot, 'skills', 'medhelp-example', 'SKILL.md'),
    '---\nname: medhelp-example\n---\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'skills', 'category', 'nested-example', 'SKILL.md'),
    '---\nname: nested-example\n---\n',
  );
  await fs.writeFile(path.join(runtimeRoot, 'templates', 'CLAUDE.md'), '# MedHelp rules\n');
  await fs.writeFile(path.join(runtimeRoot, 'templates', 'AGENTS.md'), '# MedHelp rules\n');
  await fs.writeFile(path.join(runtimeRoot, 'package.json'), `${JSON.stringify({
    name: 'medhelp-secure-headless-kernel-runtime',
    version,
    private: true,
  })}\n`);
  await fs.writeFile(path.join(runtimeRoot, 'security-manifest.json'), `${JSON.stringify({
    schemaVersion: 2,
    product: 'MedHelp Secure Headless Kernel',
    version,
    platform: 'win32',
    arch: 'x64',
    policy: {
      desktopApplicationBundled: false,
      skillsBundled: true,
      ruleTemplatesBundled: true,
      rawFirstPartySourceBundled: false,
      sourceMapsBundled: false,
      hostedApplicationOnly: true,
      nodeRuntimeBundledForCliAgents: true,
      windowsNodeBundleRuntime: true,
    },
    files: {
      'bin/node.exe': digest(nodeBytes),
      'kernel-entry.cjs': digest(kernelEntryBytes),
    },
    runtimeDependencies: {
      '@anthropic-ai/claude-agent-sdk': '0.3.220',
      '@embedpdf/fonts-sc': '1.0.0',
      '@openai/codex': '0.146.0',
      bcrypt: '^6.0.0',
      pdfkit: '^0.19.1',
    },
    nativeRuntimeDependencies: ['bcrypt'],
    nodeRuntime: {
      version: '22.22.0',
      modules: '127',
    },
  }, null, 2)}\n`);
  return runtimeRoot;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Windows headless npm package', () => {
  it('packs only the compiled Kernel runtime and background launcher', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-headless-npm-'));
    temporaryRoots.push(root);
    const runtimeSource = await createWindowsRuntime(root);
    const outputDir = path.join(root, 'package');
    const releaseDir = path.join(root, 'release');

    const result = await buildWindowsHeadlessNpmPackage({
      runtimeSource,
      outputDir,
      packDestination: releaseDir,
      allowCrossPlatform: true,
    });

    expect(path.basename(result.tarballPath)).toBe('medhelp-kernel-win32-x64-1.1.10.tgz');
    expect(result.desktopApplicationBundled).toBe(false);
    await expect(fs.readFile(`${result.tarballPath}.sha256`, 'utf8'))
      .resolves.toContain(result.sha256);

    const files = execFileSync('tar', ['-tzf', result.tarballPath], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/);
    expect(files).toContain('package/bin/medhelp-kernelctl.mjs');
    expect(files).toContain('package/runtime/bin/node.exe');
    expect(files).toContain('package/runtime/kernel-entry.cjs');
    expect(files).toContain('package/security-manifest.json');
    expect(files.some((file) => file.includes('runtime/node_modules/'))).toBe(false);
    expect(files).toContain('package/node_modules/@anthropic-ai/claude-agent-sdk/package.json');
    expect(files).toContain('package/node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf');
    expect(files).toContain('package/node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Bold.otf');
    expect(files).toContain('package/node_modules/@openai/codex/package.json');
    expect(files).toContain('package/node_modules/pdfkit/js/data/Helvetica.afm');
    expect(files).toContain('package/node_modules/pdfkit/js/data/Courier.afm');
    expect(files).toContain('package/node_modules/js-md5/src/md5.js');
    expect(files.some((file) => /^package\/(?:dist|server|shared|desktop|src|public|skills|scripts)\//i.test(file))).toBe(false);
    expect(files.some((file) => /electron|app\.asar/i.test(file))).toBe(false);

    // Skills and rule templates are read from disk at runtime, so the compiled
    // Kernel is a stock agent without them. They ship under runtime/, never as
    // a top-level package root (that would be raw repo source).
    expect(files).toContain('package/runtime/skills/medhelp-example/SKILL.md');
    expect(files).toContain('package/runtime/skills/category/nested-example/SKILL.md');
    expect(files).toContain('package/runtime/templates/CLAUDE.md');
    expect(files).toContain('package/runtime/templates/AGENTS.md');

    const packageJson = JSON.parse(await fs.readFile(path.join(outputDir, 'package.json'), 'utf8'));
    expect(packageJson).toMatchObject({
      name: 'medhelp',
      version: '1.1.10',
      os: ['win32'],
      cpu: ['x64'],
      bin: {
        medhelp: 'bin/medhelp-kernelctl.mjs',
        'medhelp-kernelctl': 'bin/medhelp-kernelctl.mjs',
      },
      scripts: {
        postinstall: 'node bin/medhelp-kernelctl.mjs postinstall',
        preuninstall: 'node bin/medhelp-kernelctl.mjs preuninstall',
      },
      dependencies: {
        '@anthropic-ai/claude-agent-sdk': '0.3.220',
        '@embedpdf/fonts-sc': '1.0.0',
        '@openai/codex': '0.146.0',
        bcrypt: '^6.0.0',
        pdfkit: '^0.19.1',
      },
      bundledDependencies: [
        '@anthropic-ai/claude-agent-sdk',
        '@embedpdf/fonts-sc',
        '@openai/codex',
        'pdfkit',
      ],
    });
    const launcher = await fs.readFile(path.join(outputDir, 'bin', 'medhelp-kernelctl.mjs'), 'utf8');
    expect(launcher).toContain('MEDHELP_LOCAL_KERNEL_SERVE_APP');
    expect(launcher).toContain('MEDHELP_SKILLS_DIR');
    expect(launcher).toContain('MEDHELP_TEMPLATES_DIR');
    expect(launcher).toContain('medhelp local-kernel start');
    expect(launcher).not.toContain('sourceMappingURL');
    expect(launcher).not.toMatch(/BrowserWindow|electron/i);
  });

  it('verifies the platform, policy, and launch file hashes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-headless-npm-verify-'));
    temporaryRoots.push(root);
    const runtimeSource = await createWindowsRuntime(root);
    const packageRoot = path.join(root, 'installed-package');
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.cp(runtimeSource, path.join(packageRoot, 'runtime'), { recursive: true });
    await fs.copyFile(
      path.join(runtimeSource, 'security-manifest.json'),
      path.join(packageRoot, 'security-manifest.json'),
    );

    expect(verifyRuntimePackage({
      packageRoot,
      platform: 'win32',
      arch: 'x64',
      version: '1.1.10',
    })).toMatchObject({
      entryPath: path.join(packageRoot, 'runtime', 'kernel-entry.cjs'),
      launchArgs: [path.join(packageRoot, 'runtime', 'kernel-entry.cjs')],
      launchPath: path.join(packageRoot, 'runtime', 'bin', 'node.exe'),
      nodeRuntimePath: path.join(packageRoot, 'runtime', 'bin', 'node.exe'),
    });

    await fs.writeFile(path.join(packageRoot, 'runtime', 'kernel-entry.cjs'), 'tampered');
    expect(() => verifyRuntimePackage({
      packageRoot,
      platform: 'win32',
      arch: 'x64',
      version: '1.1.10',
    })).toThrow(/SHA-256/);
  });

  it('uses the shared control command without registering or starting during install', async () => {
    const logPath = resolveLogPath({
      platform: 'win32',
      localAppData: 'C:\\Users\\customer\\AppData\\Local',
      runtimeFile: 'C:\\Users\\customer\\AppData\\Roaming\\MedHelp\\runtime\\local-kernel.json',
    });
    expect(logPath).toBe('C:\\Users\\customer\\AppData\\Local\\MedHelp\\logs\\kernel.log');

    const source = await fs.readFile(new URL('../../npm/windows-headless/cli.mjs', import.meta.url), 'utf8');
    const rootPackage = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    const runtimeDependencies = JSON.parse(
      await fs.readFile(new URL('../../scripts/kernel-runtime-dependencies.json', import.meta.url), 'utf8'),
    );
    expect(source).toContain('Usage: medhelp local-kernel {start|run|stop|restart|status|logs}');
    expect(source).toContain('start --background');
    expect(source).toContain("if (command === 'postinstall')");
    expect(source).toContain("console.log('medhelp local-kernel start')");
    expect(source).toContain('Kernel stopped before becoming ready');
    expect(source).not.toMatch(/installStartup|resolveStartupScriptPath|WScript\.Shell/);
    expect(runtimeDependencies['@embedpdf/fonts-sc']).toBe(rootPackage.dependencies['@embedpdf/fonts-sc']);
    expect(runtimeDependencies['@embedpdf/fonts-sc']).toBe('1.0.0');
    expect(runtimeDependencies['@anthropic-ai/claude-agent-sdk'])
      .toBe(rootPackage.dependencies['@anthropic-ai/claude-agent-sdk']);
    expect(runtimeDependencies['@openai/codex']).toBe(rootPackage.dependencies['@openai/codex']);
    expect(runtimeDependencies.pdfkit).toBe(rootPackage.dependencies.pdfkit);
    expect(runtimeDependencies['@anthropic-ai/claude-agent-sdk']).toBe('0.3.220');
    expect(runtimeDependencies['@openai/codex']).toBe('0.146.0');
    expect(rootPackage.dependencies['@openai/codex-sdk']).toBe('0.146.0');
  });

  it('rebuilds and validates native dependencies with the bundled Node runtime', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-headless-npm-native-'));
    temporaryRoots.push(root);
    const packageRoot = path.join(root, 'installed-package');
    const runtimeSource = await createWindowsRuntime(root);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.cp(runtimeSource, path.join(packageRoot, 'runtime'), { recursive: true });
    await fs.copyFile(
      path.join(runtimeSource, 'security-manifest.json'),
      path.join(packageRoot, 'security-manifest.json'),
    );
    const npmCliPath = path.join(root, 'npm-cli.js');
    await fs.writeFile(npmCliPath, '// npm fixture\n');
    const calls = [];

    const result = ensureNativeRuntimeDependencies({
      packageRoot,
      npmCliPath,
      platform: 'win32',
      arch: 'x64',
      version: '1.1.10',
      spawnSyncImpl(command, args, options) {
        calls.push({ command, args, options });
        return calls.length === 1
          ? { status: 1, stdout: '', stderr: 'ABI mismatch' }
          : { status: 0, stdout: '', stderr: '' };
      },
    });

    expect(result).toEqual({ rebuilt: true, packageNames: ['bcrypt'] });
    expect(calls).toHaveLength(3);
    expect(calls[0].command).toBe(path.join(packageRoot, 'runtime', 'bin', 'node.exe'));
    expect(calls[0].args[0]).toBe('-e');
    expect(calls[1].args).toEqual([
      npmCliPath,
      'rebuild',
      '--foreground-scripts',
      '--no-audit',
      '--no-fund',
      'bcrypt',
    ]);
    expect(calls[1].options.env.npm_config_target).toBe('22.22.0');
    expect(calls[1].options.env.npm_node_execpath).toBe(calls[0].command);
    expect(calls[1].options.env.PATH.split(path.delimiter)[0])
      .toBe(path.join(packageRoot, 'runtime', 'bin'));
    expect(calls[2].args[0]).toBe('-e');
  });

  it('keeps packaged native modules when they already match the bundled Node ABI', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-headless-npm-native-valid-'));
    temporaryRoots.push(root);
    const packageRoot = path.join(root, 'installed-package');
    const runtimeSource = await createWindowsRuntime(root);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.cp(runtimeSource, path.join(packageRoot, 'runtime'), { recursive: true });
    await fs.copyFile(
      path.join(runtimeSource, 'security-manifest.json'),
      path.join(packageRoot, 'security-manifest.json'),
    );
    const calls = [];

    const result = ensureNativeRuntimeDependencies({
      packageRoot,
      npmCliPath: null,
      platform: 'win32',
      arch: 'x64',
      version: '1.1.10',
      spawnSyncImpl(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    expect(result).toEqual({ rebuilt: false, packageNames: ['bcrypt'] });
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe('-e');
  });

  it('launches the installed Windows Claude and Codex native executables', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-headless-npm-agents-'));
    temporaryRoots.push(root);
    const packageRoot = path.join(root, 'installed-package');
    const runtimeSource = await createWindowsRuntime(root);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.cp(runtimeSource, path.join(packageRoot, 'runtime'), { recursive: true });
    await fs.copyFile(
      path.join(runtimeSource, 'security-manifest.json'),
      path.join(packageRoot, 'security-manifest.json'),
    );
    await fs.writeFile(path.join(packageRoot, 'package.json'), '{"name":"medhelp"}\n');

    const claudePackage = path.join(
      packageRoot,
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk-win32-x64',
    );
    await fs.mkdir(claudePackage, { recursive: true });
    await fs.writeFile(
      path.join(claudePackage, 'package.json'),
      '{"name":"@anthropic-ai/claude-agent-sdk-win32-x64"}\n',
    );
    await fs.writeFile(path.join(claudePackage, 'claude.exe'), 'claude');

    const codexPackage = path.join(packageRoot, 'node_modules', '@openai', 'codex');
    const codexNativePackage = path.join(codexPackage, 'node_modules', '@openai', 'codex-win32-x64');
    const codexExecutable = path.join(
      codexNativePackage,
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe',
    );
    await fs.mkdir(path.dirname(codexExecutable), { recursive: true });
    await fs.writeFile(path.join(codexPackage, 'package.json'), '{"name":"@openai/codex"}\n');
    await fs.writeFile(
      path.join(codexNativePackage, 'package.json'),
      '{"name":"@openai/codex-win32-x64"}\n',
    );
    await fs.writeFile(codexExecutable, 'codex');
    const calls = [];

    const executables = verifyAgentExecutables({
      packageRoot,
      platform: 'win32',
      arch: 'x64',
      version: '1.1.10',
      spawnSyncImpl(command, args) {
        calls.push({ command, args });
        return { status: 0, stdout: 'version', stderr: '' };
      },
    });

    expect(executables).toEqual({
      claudeExecutable: await fs.realpath(path.join(claudePackage, 'claude.exe')),
      codexExecutable: await fs.realpath(codexExecutable),
    });
    expect(calls).toEqual([
      { command: executables.claudeExecutable, args: ['--version'] },
      { command: executables.codexExecutable, args: ['--version'] },
    ]);
  });

  it('reclaims a fresh-looking start lock when its owner process is gone', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-headless-npm-lock-'));
    temporaryRoots.push(root);
    const runtimeFile = path.join(root, 'runtime', 'local-kernel.json');
    const lockPath = resolveStartLockPath(runtimeFile);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, '424242\n', 'utf8');
    const oldTime = new Date(Date.now() - 2_000);
    await fs.utimes(lockPath, oldTime, oldTime);

    expect(acquireStartLock(runtimeFile, {
      processId: 5151,
      killImpl: () => {
        const error = new Error('not found');
        error.code = 'ESRCH';
        throw error;
      },
    })).toBe(lockPath);
    await expect(fs.readFile(lockPath, 'utf8')).resolves.toBe('5151\n');
  });

  it('preserves a start lock while its owner process is alive', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-headless-npm-active-lock-'));
    temporaryRoots.push(root);
    const runtimeFile = path.join(root, 'runtime', 'local-kernel.json');
    const lockPath = resolveStartLockPath(runtimeFile);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, '424242\n', 'utf8');
    const oldTime = new Date(Date.now() - 2_000);
    await fs.utimes(lockPath, oldTime, oldTime);

    expect(acquireStartLock(runtimeFile, {
      processId: 5151,
      killImpl: () => {},
    })).toBeNull();
    await expect(fs.readFile(lockPath, 'utf8')).resolves.toBe('424242\n');
  });

  it('keeps the existing medhelp local-kernel command syntax', async () => {
    const output = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)));
    try {
      await main(['local-kernel', '--help']);
    } finally {
      logSpy.mockRestore();
    }
    expect(output).toContain('Usage: medhelp local-kernel {start|run|stop|restart|status|logs}');
    expect(output).toContain('Use --no-open to start without opening the MedHelp page.');
  });

  it('opens the hosted MedHelp page with the normal Windows desktop browser', () => {
    const calls = [];
    const child = { once: vi.fn(), unref: vi.fn() };
    const result = openCloudApp({
      platform: 'win32',
      url: 'https://app.medtimehelp.com',
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return child;
      },
    });

    expect(result).toBe('https://app.medtimehelp.com/');
    expect(calls).toEqual([{
      command: 'explorer.exe',
      args: ['https://app.medtimehelp.com/'],
      options: { detached: true, windowsHide: true, stdio: 'ignore' },
    }]);
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
