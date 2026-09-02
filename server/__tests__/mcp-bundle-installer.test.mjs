import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  installMcpBundle,
  inspectMcpBundle,
  McpBundleInstallError,
} from '../utils/mcpBundleInstaller.js';

const temporaryRoots = [];

async function makeTemporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-mcpb-test-'));
  temporaryRoots.push(root);
  return root;
}

function writeBundle(bundlePath, overrides = {}) {
  const manifest = {
    manifest_version: '0.3',
    name: 'sample-local-tools',
    display_name: 'Sample Local Tools',
    version: '1.2.3',
    description: 'A self-contained test package.',
    author: { name: 'MedHelp Tests' },
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js', '--offline'],
        env: {
          SAMPLE_ROOT: '${__dirname}',
          SAMPLE_ASSET: '${__dirname}/assets/example.txt',
          USER_HOME: '${HOME}',
        },
      },
    },
    ...overrides,
  };
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  zip.addFile('server/index.js', Buffer.from('console.log("sample");\n'));
  zip.addFile('assets/example.txt', Buffer.from('offline fixture\n'));
  zip.writeZip(bundlePath);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('local MCP bundle installer', () => {
  it('installs for Pi without reading or changing Claude configuration', async () => {
    const root = await makeTemporaryRoot();
    const homeDir = path.join(root, 'home');
    const archivePath = path.join(root, 'sample.mcpb');
    await fs.mkdir(homeDir, { recursive: true });
    // Even malformed Claude JSON must not block an unrelated Pi installation.
    await fs.writeFile(path.join(homeDir, '.claude.json'), 'do not touch');
    writeBundle(archivePath);
    const options = { archivePath, homeDir, dataRoot: path.join(root, 'data'), processExecPath: process.execPath, target: 'pi' };
    const installed = await installMcpBundle(options);
    expect(installed).toMatchObject({ target: 'pi', configPath: null, backupPath: null, reused: false });
    expect(await fs.readFile(path.join(homeDir, '.claude.json'), 'utf8')).toBe('do not touch');
    const { resolveTrustedPiMcpServers } = await import('../pi-runtime/mcp-projection.js');
    expect((await resolveTrustedPiMcpServers({ mcpBundlesRoot: path.join(root, 'data', 'mcp-bundles') })).servers).toHaveLength(1);
    expect(await installMcpBundle(options)).toMatchObject({ reused: true, target: 'pi' });
    expect(await fs.readdir(homeDir)).toEqual(['.claude.json']);
  });
  it('installs an MCPB locally and preserves unrelated Claude configuration', async () => {
    const root = await makeTemporaryRoot();
    const homeDir = path.join(root, 'home');
    const dataRoot = path.join(root, 'data');
    const archivePath = path.join(root, 'sample.mcpb');
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(path.join(homeDir, '.claude.json'), JSON.stringify({
      preferences: { theme: 'dark' },
      mcpServers: { existing: { type: 'stdio', command: '/bin/existing', args: [] } },
    }));
    writeBundle(archivePath);

    const installed = await installMcpBundle({
      archivePath,
      homeDir,
      dataRoot,
      processExecPath: process.execPath,
    });

    const config = JSON.parse(await fs.readFile(path.join(homeDir, '.claude.json'), 'utf8'));
    const server = config.mcpServers['sample-local-tools'];
    expect(config.preferences).toEqual({ theme: 'dark' });
    expect(config.mcpServers.existing.command).toBe('/bin/existing');
    expect(server.command).toBe(process.execPath);
    expect(server.args).toEqual([path.join(installed.installRoot, 'server/index.js'), '--offline']);
    expect(server.env.SAMPLE_ROOT).toBe(installed.installRoot);
    expect(server.env.SAMPLE_ASSET).toBe(path.join(installed.installRoot, 'assets/example.txt'));
    expect(server.env.USER_HOME).toBe(homeDir);
    expect(server.env.MEDHELP_MCP_BUNDLE_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(await fs.readFile(path.join(installed.installRoot, 'assets/example.txt'), 'utf8')).toBe('offline fixture\n');
    const metadata = JSON.parse(await fs.readFile(
      path.join(installed.installRoot, '.medhelp-mcpb.json'),
      'utf8',
    ));
    expect(metadata).toMatchObject({
      schema: 'medhelp.mcp-bundle-install.v2',
      entryPoint: 'server/index.js',
      piProjection: server,
    });
    expect(metadata.entryPointSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(installed.backupPath).toBeTruthy();
    expect(await fs.readFile(installed.backupPath, 'utf8')).toContain('"existing"');
  });

  it('is idempotent when the same bundle is installed twice', async () => {
    const root = await makeTemporaryRoot();
    const homeDir = path.join(root, 'home');
    const archivePath = path.join(root, 'sample.mcpb');
    writeBundle(archivePath);

    const first = await installMcpBundle({ archivePath, homeDir, dataRoot: path.join(root, 'data') });
    const second = await installMcpBundle({ archivePath, homeDir, dataRoot: path.join(root, 'data') });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.installRoot).toBe(first.installRoot);
  });

  it('rejects packages whose declared server entry point is missing', async () => {
    const root = await makeTemporaryRoot();
    const archivePath = path.join(root, 'invalid.mcpb');
    writeBundle(archivePath, {
      server: {
        type: 'node',
        entry_point: 'server/missing.js',
        mcp_config: { command: 'node', args: [] },
      },
    });

    expect(() => inspectMcpBundle(archivePath)).toThrow(McpBundleInstallError);
    expect(() => inspectMcpBundle(archivePath)).toThrow(/entry point is missing/i);
  });

  it('does not overwrite an MCP server with the same name', async () => {
    const root = await makeTemporaryRoot();
    const homeDir = path.join(root, 'home');
    const archivePath = path.join(root, 'sample.mcpb');
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(path.join(homeDir, '.claude.json'), JSON.stringify({
      mcpServers: { 'sample-local-tools': { type: 'stdio', command: '/custom/server', args: [] } },
    }));
    writeBundle(archivePath);

    await expect(installMcpBundle({ archivePath, homeDir, dataRoot: path.join(root, 'data') }))
      .rejects.toMatchObject({ status: 409 });
    const config = JSON.parse(await fs.readFile(path.join(homeDir, '.claude.json'), 'utf8'));
    expect(config.mcpServers['sample-local-tools'].command).toBe('/custom/server');
  });
});
