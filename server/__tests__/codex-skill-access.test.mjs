import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CODEX_SKILL_REMINDER_INTERVAL,
  resolveCodexSkillDirs,
  buildCodexSkillReadOnlyConfig,
  buildCodexShellEnvironmentPolicy,
  buildCodexWindowsCompatibilityConfig,
  buildCodexSkillsPromptSection,
  buildCodexSkillsReminderSection,
  buildCodexSkillsPromptForTurn,
  resolveCodexSkillTurnNumber,
  shouldInjectCodexSkillPrompt,
  assembleCodexTurnPrompt,
} from '../utils/codexSkillAccess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempRoots = [];
async function tmp() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-codex-skill-'));
  tempRoots.push(d);
  return d;
}
afterEach(async () => {
  for (const d of tempRoots.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

describe('resolveCodexSkillDirs', () => {
  it('returns only existing directories, resolved absolute', async () => {
    const sys = await tmp();
    const missingUser = path.join(await tmp(), 'does-not-exist');
    const dirs = await resolveCodexSkillDirs('7', {
      systemSkillsDir: sys,
      userSkillsDir: missingUser,
    });
    expect(dirs).toEqual([path.resolve(sys)]);
  });

  it('includes both system and user dirs when both exist', async () => {
    const sys = await tmp();
    const usr = await tmp();
    const dirs = await resolveCodexSkillDirs('7', { systemSkillsDir: sys, userSkillsDir: usr });
    expect(dirs).toEqual([path.resolve(sys), path.resolve(usr)]);
  });
});

describe('Codex SDK wiring', () => {
  it('does not grant skill source dirs as writable additional directories', async () => {
    const source = await fs.readFile(path.join(__dirname, '..', 'openai-codex.js'), 'utf8');
    expect(source).not.toContain('additionalDirectories');
  });
});

describe('buildCodexSkillsPromptSection', () => {
  it('returns empty string when no dirs', () => {
    expect(buildCodexSkillsPromptSection([])).toBe('');
    expect(buildCodexSkillsPromptSection(null)).toBe('');
  });

  it('lists absolute dirs and tells the agent to read SKILL.md there', () => {
    const section = buildCodexSkillsPromptSection(['/opt/medhelp/skills', '/home/u/skills']);
    expect(section).toContain('/opt/medhelp/skills');
    expect(section).toContain('/home/u/skills');
    expect(section).toContain('SKILL.md');
  });
});

describe('periodic Codex skill reminders', () => {
  it('uses a four-turn reminder cadence', () => {
    expect(CODEX_SKILL_REMINDER_INTERVAL).toBe(4);
    expect(resolveCodexSkillTurnNumber({ isFirstTurn: true, sessionMetadata: null })).toBe(1);
    expect(resolveCodexSkillTurnNumber({
      isFirstTurn: false,
      sessionMetadata: { codexSkillTurnCount: 3 },
    })).toBe(4);
  });

  it('injects on the first turn and then every fourth turn', () => {
    expect(shouldInjectCodexSkillPrompt({ isFirstTurn: true, turnNumber: 1 })).toBe(true);
    expect(shouldInjectCodexSkillPrompt({ isFirstTurn: false, turnNumber: 2 })).toBe(false);
    expect(shouldInjectCodexSkillPrompt({ isFirstTurn: false, turnNumber: 3 })).toBe(false);
    expect(shouldInjectCodexSkillPrompt({ isFirstTurn: false, turnNumber: 4 })).toBe(true);
    expect(shouldInjectCodexSkillPrompt({ isFirstTurn: false, turnNumber: 8 })).toBe(true);
  });

  it('uses a short reminder on periodic resumed turns', () => {
    const section = buildCodexSkillsPromptForTurn(['/opt/medhelp/skills'], {
      isFirstTurn: false,
      turnNumber: 4,
    });

    expect(section).toContain('# MedHelp Skills Reminder');
    expect(section).toContain('/opt/medhelp/skills');
    expect(section).toContain("Codex's installation directory");
  });

  it('does not inject a periodic reminder before the cadence turn', () => {
    expect(buildCodexSkillsPromptForTurn(['/opt/medhelp/skills'], {
      isFirstTurn: false,
      turnNumber: 3,
    })).toBe('');
  });

  it('can build the reminder directly', () => {
    const section = buildCodexSkillsReminderSection(['/opt/medhelp/skills']);
    expect(section).toContain('# MedHelp Skills Reminder');
    expect(section).toContain('SKILL.md');
  });
});

describe('buildCodexSkillReadOnlyConfig', () => {
  it('does not request sandbox config when no skill dirs exist', () => {
    expect(buildCodexSkillReadOnlyConfig([])).toBeNull();
    expect(buildCodexSkillReadOnlyConfig(null)).toBeNull();
  });

  it('requests read-only disk access instead of writable additional directories', () => {
    expect(buildCodexSkillReadOnlyConfig(['/opt/medhelp/skills'])).toEqual({
      sandbox_permissions: ['disk-full-read-access'],
    });
  });
});

describe('buildCodexShellEnvironmentPolicy', () => {
  it('passes the managed database credential without exposing unrelated secrets', () => {
    const policy = buildCodexShellEnvironmentPolicy({
      PATH: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      MEDHELP_MANAGED_AGENT_SESSION: '1',
      MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
      MEDHELP_DATABASE_API_TOKEN: 'database-token-value',
      DATABASE_API_TOKEN: 'legacy-database-token-value',
      OPENAI_API_KEY: 'must-stay-hidden',
      GITHUB_TOKEN: 'must-stay-hidden',
      SERVICE_PASSWORD: 'must-stay-hidden',
      MEDHELP_CLOUD_ACCESS_TOKEN: 'must-stay-hidden',
    }, { platform: 'win32' });

    expect(policy).toMatchObject({
      inherit: 'all',
      ignore_default_excludes: true,
    });
    expect(policy.include_only).toContain('PATH');
    expect(policy.include_only).toContain('MEDHELP_MANAGED_AGENT_SESSION');
    expect(policy.include_only).toContain('MEDHELP_DATABASE_API_CONNECTION_STATUS');
    expect(policy.include_only).toContain('MEDHELP_DATABASE_API_TOKEN');
    expect(policy.include_only).toContain('DATABASE_API_TOKEN');
    expect(policy.include_only).not.toContain('OPENAI_API_KEY');
    expect(policy.include_only).not.toContain('GITHUB_TOKEN');
    expect(policy.include_only).not.toContain('SERVICE_PASSWORD');
    expect(policy.include_only).not.toContain('MEDHELP_CLOUD_ACCESS_TOKEN');
    expect(policy.include_only.some((name) => name.startsWith('^') || name.endsWith('$'))).toBe(false);
    expect(policy.set).toEqual({
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    });
    expect(JSON.stringify(policy)).not.toContain('database-token-value');
    expect(JSON.stringify(policy)).not.toContain('must-stay-hidden');
  });

  it('returns null for an empty environment', () => {
    expect(buildCodexShellEnvironmentPolicy({}, { platform: 'linux' })).toBeNull();
    expect(buildCodexShellEnvironmentPolicy(null, { platform: 'linux' })).toBeNull();
  });

  it('synthesizes critical Windows variables when the launch environment omits them', () => {
    const policy = buildCodexShellEnvironmentPolicy({ PATH: 'C:\\Tools' }, { platform: 'win32' });
    expect(policy.set).toEqual({
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
    });
    expect(policy.include_only).toEqual(expect.arrayContaining([
      'SystemRoot',
      'windir',
      'COMSPEC',
      'PATHEXT',
    ]));
  });
});

describe('buildCodexWindowsCompatibilityConfig', () => {
  it('uses the unelevated runner only on Windows', () => {
    expect(buildCodexWindowsCompatibilityConfig('win32')).toEqual({
      windows: { sandbox: 'unelevated' },
    });
    expect(buildCodexWindowsCompatibilityConfig('linux')).toBeNull();
    expect(buildCodexWindowsCompatibilityConfig('darwin')).toBeNull();
  });
});

describe('assembleCodexTurnPrompt', () => {
  it('injects skills and project instructions on the first turn of a new thread', () => {
    const out = assembleCodexTurnPrompt({
      isFirstTurn: true,
      skillsSection: 'SKILLS',
      instructedCommand: 'RULES\n\ntask',
      plainCommand: 'task',
    });

    expect(out).toBe('SKILLS\n\nRULES\n\ntask');
  });

  it('omits an empty skills section on the first turn', () => {
    const out = assembleCodexTurnPrompt({
      isFirstTurn: true,
      skillsSection: '',
      instructedCommand: 'RULES\n\ntask',
      plainCommand: 'task',
    });

    expect(out).toBe('RULES\n\ntask');
  });

  it('injects a periodic skills section on resumed turns when present', () => {
    const out = assembleCodexTurnPrompt({
      isFirstTurn: false,
      skillsSection: 'SKILLS',
      instructedCommand: 'RULES\n\ntask',
      plainCommand: 'task',
    });

    expect(out).toBe('SKILLS\n\ntask');
  });

  it('sends only the plain command on resumed turns without a skills section', () => {
    const out = assembleCodexTurnPrompt({
      isFirstTurn: false,
      skillsSection: '',
      instructedCommand: 'RULES\n\ntask',
      plainCommand: 'task',
    });

    expect(out).toBe('task');
  });
});
