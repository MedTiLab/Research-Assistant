import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  repairNodePtySpawnHelper,
  resolveLogPath,
  resolveRuntimeFilePath,
  verifyRuntimePackage,
} from '../../npm/windows-headless/cli.mjs';
import { buildHeadlessNpmPackage } from '../../scripts/packaging/local-engine/package-npm.mjs';

const temporaryRoots = [];

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function createMacRuntime(root, version = '1.1.10') {
  const runtimeRoot = path.join(root, 'runtime-source');
  const kernelBytes = Buffer.from('compiled-macos-sea-kernel');
  const nodeBytes = Buffer.from('isolated-macos-node-runtime');
  const computeMcpBytes = Buffer.from('compiled-compute-mcp');
  await fs.mkdir(path.join(runtimeRoot, 'bin'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'fonts'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', '@openai', 'codex'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', 'pdfkit', 'js', 'data'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'node_modules', 'js-md5', 'src'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'skills', 'demo'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'templates'), { recursive: true });
  await fs.writeFile(path.join(runtimeRoot, 'bin', 'medhelp-kernel'), kernelBytes);
  await fs.writeFile(path.join(runtimeRoot, 'bin', 'node'), nodeBytes);
  await fs.writeFile(path.join(runtimeRoot, 'agent-compute-mcp.cjs'), computeMcpBytes);
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
    '{"name":"@anthropic-ai/claude-agent-sdk","version":"0.3.220"}\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@openai', 'codex', 'package.json'),
    '{"name":"@openai/codex","version":"0.146.0"}\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'package.json'),
    '{"name":"@embedpdf/fonts-sc","version":"1.0.0"}\n',
  );
  await fs.writeFile(
    path.join(runtimeRoot, 'node_modules', '@embedpdf', 'fonts-sc', 'fonts', 'NotoSansHans-Regular.otf'),
    'regular-font',
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
  await fs.writeFile(path.join(runtimeRoot, 'skills', 'demo', 'SKILL.md'), '# demo\n');
  await fs.writeFile(path.join(runtimeRoot, 'templates', 'CLAUDE.md'), '# rules\n');
  await fs.writeFile(path.join(runtimeRoot, 'templates', 'AGENTS.md'), '# rules\n');
  await fs.writeFile(path.join(runtimeRoot, 'package.json'), `${JSON.stringify({
    name: 'medhelp-secure-headless-kernel-runtime',
    version,
    private: true,
  })}\n`);
  await fs.writeFile(path.join(runtimeRoot, 'security-manifest.json'), `${JSON.stringify({
    schemaVersion: 2,
    product: 'MedHelp Secure Headless Kernel',
    version,
    platform: 'darwin',
    arch: 'arm64',
    policy: {
      desktopApplicationBundled: false,
      skillsBundled: true,
      ruleTemplatesBundled: true,
      rawFirstPartySourceBundled: false,
      sourceMapsBundled: false,
      hostedApplicationOnly: true,
    },
    assets: {
      agentComputeMcp: 'agent-compute-mcp.cjs',
    },
    files: {
      'bin/medhelp-kernel': digest(kernelBytes),
      'bin/node': digest(nodeBytes),
      'agent-compute-mcp.cjs': digest(computeMcpBytes),
    },
    runtimeDependencies: {
      '@anthropic-ai/claude-agent-sdk': '0.3.220',
      '@embedpdf/fonts-sc': '1.0.0',
      '@openai/codex': '0.146.0',
      pdfkit: '^0.19.1',
    },
    nativeRuntimeDependencies: [],
  }, null, 2)}\n`);
  return runtimeRoot;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('macOS headless npm package', () => {
  it('repairs the packaged node-pty helper so password SSH can spawn', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-macos-node-pty-'));
    temporaryRoots.push(root);
    const helperPath = path.join(
      root,
      'node_modules',
      'node-pty',
      'prebuilds',
      'darwin-arm64',
      'spawn-helper',
    );
    await fs.mkdir(path.dirname(helperPath), { recursive: true });
    await fs.writeFile(helperPath, 'helper');
    await fs.chmod(helperPath, 0o644);

    const result = repairNodePtySpawnHelper({
      packageRoot: root,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(result).toEqual({ repaired: true, helperPath });
    expect((await fs.stat(helperPath)).mode & 0o777).toBe(0o755);
  });

  it('ships the compiled Apple silicon runtime, skills, and rules without frontend files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-macos-npm-'));
    temporaryRoots.push(root);
    const runtimeSource = await createMacRuntime(root);
    const outputDir = path.join(root, 'package');
    const result = await buildHeadlessNpmPackage({
      runtimeSource,
      outputDir,
      packDestination: path.join(root, 'release'),
      expectedPlatform: 'darwin',
      expectedArch: 'arm64',
      allowCrossPlatform: true,
    });

    expect(path.basename(result.tarballPath)).toBe('medhelp-kernel-darwin-arm64-1.1.10.tgz');
    const files = execFileSync('tar', ['-tzf', result.tarballPath], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/);
    expect(files).toContain('package/runtime/bin/medhelp-kernel');
    expect(files).toContain('package/runtime/bin/node');
    expect(files).toContain('package/runtime/agent-compute-mcp.cjs');
    expect(files).toContain('package/runtime/skills/demo/SKILL.md');
    expect(files).toContain('package/runtime/templates/CLAUDE.md');
    expect(files).toContain('package/runtime/templates/AGENTS.md');
    expect(files).toContain('package/node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf');
    expect(files).toContain('package/node_modules/pdfkit/js/data/Helvetica.afm');
    expect(files).toContain('package/node_modules/pdfkit/js/data/Courier.afm');
    expect(files).toContain('package/node_modules/js-md5/src/md5.js');
    expect(files.some((file) => /^package\/(?:dist|server|shared|desktop|src|public|skills|scripts)\//i.test(file)))
      .toBe(false);

    const packageJson = JSON.parse(await fs.readFile(path.join(outputDir, 'package.json'), 'utf8'));
    expect(packageJson).toMatchObject({
      name: 'medhelp',
      os: ['darwin'],
      cpu: ['arm64'],
      bin: {
        medhelp: 'bin/medhelp-kernelctl.mjs',
      },
      bundledDependencies: [
        '@anthropic-ai/claude-agent-sdk',
        '@embedpdf/fonts-sc',
        '@openai/codex',
        'pdfkit',
      ],
    });
  });

  it('uses macOS user paths and verifies both runtime executables', async () => {
    const homeDir = '/Users/customer';
    expect(resolveRuntimeFilePath({ platform: 'darwin', homeDir })).toBe(
      '/Users/customer/Library/Application Support/MedHelp/runtime/local-kernel.json',
    );
    expect(resolveLogPath({ platform: 'darwin', homeDir })).toBe(
      '/Users/customer/Library/Logs/MedHelp/kernel.log',
    );

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-macos-npm-verify-'));
    temporaryRoots.push(root);
    const runtimeSource = await createMacRuntime(root);
    const packageRoot = path.join(root, 'installed');
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.cp(runtimeSource, path.join(packageRoot, 'runtime'), { recursive: true });
    await fs.copyFile(
      path.join(runtimeSource, 'security-manifest.json'),
      path.join(packageRoot, 'security-manifest.json'),
    );

    expect(verifyRuntimePackage({
      packageRoot,
      platform: 'darwin',
      arch: 'arm64',
      version: '1.1.10',
    })).toMatchObject({
      executablePath: path.join(packageRoot, 'runtime', 'bin', 'medhelp-kernel'),
      nodeRuntimePath: path.join(packageRoot, 'runtime', 'bin', 'node'),
      agentComputeMcpPath: path.join(packageRoot, 'runtime', 'agent-compute-mcp.cjs'),
    });
  });

  it('rejects a compute MCP manifest asset that escapes the runtime directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-macos-npm-traversal-'));
    temporaryRoots.push(root);
    const runtimeSource = await createMacRuntime(root);
    const packageRoot = path.join(root, 'installed');
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.cp(runtimeSource, path.join(packageRoot, 'runtime'), { recursive: true });
    const manifest = JSON.parse(await fs.readFile(
      path.join(runtimeSource, 'security-manifest.json'),
      'utf8',
    ));
    manifest.assets.agentComputeMcp = '../agent-compute-mcp.cjs';
    await fs.writeFile(
      path.join(packageRoot, 'security-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    expect(() => verifyRuntimePackage({
      packageRoot,
      platform: 'darwin',
      arch: 'arm64',
      version: '1.1.10',
    })).toThrow('Agent compute MCP asset has an invalid runtime-relative path');
  });
});
