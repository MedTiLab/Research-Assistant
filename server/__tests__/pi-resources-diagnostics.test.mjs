import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { PI_MCP_INSTALL_SCHEMA, resolveTrustedPiMcpServers } from '../pi-runtime/mcp-projection.js';
import { createTrustedPiSkillProjection, resolveTrustedPiSkills } from '../pi-runtime/skill-projection.js';
import {
  PI_HOST_BUILD_ID,
  PI_MCP_SDK_PACKAGE,
  PI_MCP_SDK_VERSION,
  PI_RUNTIME_MANIFEST_SCHEMA,
  PI_SCHEMA_PACKAGE,
  PI_SCHEMA_VERSION,
  diagnosePiHostLaunch,
} from '../pi-runtime/runtime-diagnostics.js';
import { PI_HOST_PROTOCOL_VERSION } from '../pi-runtime/rpc-client.js';
import { PI_SDK_PACKAGE, PI_SDK_VERSION } from '../pi-runtime/provider-config.js';
import { countSkillDirectories } from '../../desktop/common/skillBundleValidation.mjs';

const roots = [];

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-resources-'));
  roots.push(root);
  return root;
}

async function writeSkill(root, name, description = name) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
  return skillDir;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('trusted Pi skill projection', () => {
  it('projects system and explicitly managed user skills while rejecting collisions and unmanaged folders', async () => {
    const root = await temporaryRoot();
    const systemRoot = path.join(root, 'system');
    const userRoot = path.join(root, 'user');
    const configRoot = path.join(root, 'config');
    await writeSkill(systemRoot, 'system-skill');
    await writeSkill(path.join(systemRoot, 'agents'), 'nested-skill');
    await writeSkill(userRoot, 'user-skill');
    await writeSkill(userRoot, 'rogue-skill');
    await writeSkill(userRoot, 'system-skill', 'must not shadow the trusted system skill');
    await fs.writeFile(path.join(userRoot, 'stage-skill-map.json'), JSON.stringify({
      skillOrigins: { 'user-skill': 'user-import', 'system-skill': 'user-import' },
    }));

    const resolved = await resolveTrustedPiSkills({
      systemSkillsDir: systemRoot,
      userSkillsDir: userRoot,
    });
    expect(resolved.skills.map(({ name, source }) => [name, source])).toEqual([
      ['system-skill', 'system'],
      ['nested-skill', 'system'],
      ['user-skill', 'user'],
    ]);
    expect(resolved.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'rogue-skill', code: 'unmanaged_user_skill' }),
      expect.objectContaining({ name: 'system-skill', source: 'user', code: 'name_collision' }),
    ]));

    await fs.mkdir(configRoot, { recursive: true });
    const projection = await createTrustedPiSkillProjection(configRoot, resolved);
    expect(projection.paths).toEqual(['skills/system-skill', 'skills/nested-skill', 'skills/user-skill']);
    await expect(fs.readFile(path.join(configRoot, projection.paths[0], 'SKILL.md'), 'utf8'))
      .resolves.toContain('system-skill');
  });

  it('recursively finds the dashboard catalog and projects each unique skill name once', async () => {
    const systemSkillsDir = path.resolve(fileURLToPath(new URL('../../skills', import.meta.url)));
    const resolved = await resolveTrustedPiSkills({ systemSkillsDir, userSkillsDir: null });
    const sourceSkillCount = await countSkillDirectories(systemSkillsDir);
    const collisionCount = resolved.diagnostics.filter((item) => item.code === 'name_collision').length;
    expect(resolved.skills).toHaveLength(sourceSkillCount - collisionCount);
    expect(resolved.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'pdf', sourceDir: path.join(systemSkillsDir, 'document-skills', 'pdf') }),
      expect.objectContaining({ name: 'xlsx', sourceDir: path.join(systemSkillsDir, 'document-skills', 'xlsx') }),
    ]));
    expect(resolved.skills.find((skill) => skill.name === 'docx')?.sourceDir).toBe(path.join(systemSkillsDir, 'docx'));
    expect(resolved.diagnostics).toContainEqual(expect.objectContaining({ name: 'docx', code: 'name_collision' }));
  });
});

describe('trusted Pi MCP projection', () => {
  it('accepts only MedHelp v2 install records and rejects a modified entry point', async () => {
    const root = await temporaryRoot();
    const bundlesRoot = path.join(root, 'mcp-bundles');
    const installRoot = path.join(bundlesRoot, 'trusted-tools', '1.2.3');
    const entryPoint = path.join(installRoot, 'server.mjs');
    const source = 'process.stdin.resume();\n';
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(entryPoint, source);
    await fs.writeFile(path.join(installRoot, '.medhelp-mcpb.json'), JSON.stringify({
      schema: PI_MCP_INSTALL_SCHEMA,
      name: 'trusted-tools',
      version: '1.2.3',
      sha256: 'a'.repeat(64),
      entryPoint: 'server.mjs',
      entryPointSha256: sha256(source),
      piProjection: {
        type: 'stdio',
        command: process.execPath,
        args: [entryPoint],
        env: { FIXTURE_SECRET: 'never-log-this-value' },
      },
    }));

    const trusted = await resolveTrustedPiMcpServers({ mcpBundlesRoot: bundlesRoot });
    expect(trusted.servers).toHaveLength(1);
    expect(trusted.servers[0]).toMatchObject({ name: 'trusted-tools', version: '1.2.3' });
    expect(trusted.secretValues).toContain('never-log-this-value');

    await fs.writeFile(entryPoint, 'tampered\n');
    const rejected = await resolveTrustedPiMcpServers({ mcpBundlesRoot: bundlesRoot });
    expect(rejected.servers).toHaveLength(0);
    expect(rejected.diagnostics).toContainEqual(expect.objectContaining({
      name: 'trusted-tools', code: 'entry_point_tampered',
    }));
  });
});

describe('Pi prepared runtime diagnostics', () => {
  it.each(['prepared', 'bundled'])('verifies %s SDKs, Host hash, platform and manifest before reporting ready', async (source) => {
    const root = await temporaryRoot();
    let hostPath = path.join(root, 'sdk-host.mjs');
    const hostSource = 'process.stdin.resume();\n';
    await fs.writeFile(hostPath, hostSource);
    for (const [packageName, version] of [
      [PI_SDK_PACKAGE, PI_SDK_VERSION],
      [PI_MCP_SDK_PACKAGE, PI_MCP_SDK_VERSION],
      [PI_SCHEMA_PACKAGE, PI_SCHEMA_VERSION],
    ]) {
      const packageDir = path.join(root, 'node_modules', ...packageName.split('/'));
      await fs.mkdir(packageDir, { recursive: true });
      await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ version }));
    }
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      schema: PI_RUNTIME_MANIFEST_SCHEMA,
      kind: 'pi-sdk-host',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostBuildId: PI_HOST_BUILD_ID,
      sdkPackage: PI_SDK_PACKAGE,
      sdkVersion: PI_SDK_VERSION,
      mcpSdkPackage: PI_MCP_SDK_PACKAGE,
      mcpSdkVersion: PI_MCP_SDK_VERSION,
      schemaPackage: PI_SCHEMA_PACKAGE,
      schemaVersion: PI_SCHEMA_VERSION,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hostPath: source === 'bundled' ? 'sdk-host.mjs' : hostPath,
      sha256: sha256(hostSource),
    }));

    if (source === 'bundled') {
      const relocatedRoot = path.join(await temporaryRoot(), 'Installed App', 'pi-runtime');
      await fs.mkdir(path.dirname(relocatedRoot), { recursive: true });
      await fs.rename(root, relocatedRoot);
      hostPath = path.join(relocatedRoot, 'sdk-host.mjs');
    }
    const launch = { hostPath, source };
    await expect(diagnosePiHostLaunch(launch)).resolves.toMatchObject({
      status: 'ready', health: 'healthy', available: true, verified: true, upgradeRequired: false,
    });
    await fs.appendFile(hostPath, '// modified\n');
    const invalid = await diagnosePiHostLaunch(launch);
    expect(invalid).toMatchObject({
      status: 'upgrade_required', health: 'unavailable', available: false, verified: false, upgradeRequired: true,
    });
    expect(invalid.issues).toContainEqual(expect.objectContaining({ code: 'PI_HOST_INTEGRITY_FAILED' }));
  });
});
