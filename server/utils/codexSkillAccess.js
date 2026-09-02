import { promises as fs } from 'fs';
import path from 'path';
import { resolveSystemSkillsDir } from './kernelAssetPaths.js';
import { resolveUserSkillsDir } from './storagePaths.js';

const SYSTEM_SKILLS_DIR = resolveSystemSkillsDir();
export const CODEX_SKILL_REMINDER_INTERVAL = 4;

const CODEX_SHELL_SENSITIVE_ENV_NAME = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i;
const CODEX_SHELL_EXPLICITLY_ALLOWED_SECRETS = new Set([
  'MEDHELP_DATABASE_API_TOKEN',
  'DATABASE_API_TOKEN',
]);

function firstNonEmptyEnvValue(env, names, fallback = '') {
  for (const name of names) {
    const value = typeof env?.[name] === 'string' ? env[name].trim() : '';
    if (value) return value;
  }
  return fallback;
}

function buildCodexWindowsShellEnvironmentSet(env) {
  const systemRoot = firstNonEmptyEnvValue(env, ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR'], 'C:\\Windows');
  return {
    SystemRoot: systemRoot,
    windir: firstNonEmptyEnvValue(env, ['windir', 'WINDIR', 'SystemRoot', 'SYSTEMROOT'], systemRoot),
    COMSPEC: firstNonEmptyEnvValue(
      env,
      ['COMSPEC', 'ComSpec'],
      path.win32.join(systemRoot, 'System32', 'cmd.exe'),
    ),
    PATHEXT: firstNonEmptyEnvValue(
      env,
      ['PATHEXT', 'PathExt'],
      '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
    ),
  };
}

async function dirExists(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve backend directories that hold MedHelp skills for a user. These live
 * outside customer projects; Codex is granted read-only access through CLI
 * sandbox configuration, not through writable --add-dir roots.
 *
 * @param {string|number|null} userId
 * @param {{systemSkillsDir?: string, userSkillsDir?: string|null}} [options]
 * @returns {Promise<string[]>} existing absolute directories, system first
 */
export async function resolveCodexSkillDirs(userId, options = {}) {
  const systemSkillsDir = options.systemSkillsDir || SYSTEM_SKILLS_DIR;
  const userSkillsDir = Object.prototype.hasOwnProperty.call(options, 'userSkillsDir')
    ? options.userSkillsDir
    : (userId != null ? resolveUserSkillsDir(userId) : null);

  const candidates = [systemSkillsDir, userSkillsDir].filter(Boolean);
  const existing = [];
  for (const dir of candidates) {
    if (await dirExists(dir)) {
      existing.push(path.resolve(dir));
    }
  }
  return existing;
}

/**
 * Build Codex CLI config that lets agents read backend skill source paths
 * without making those directories writable. The SDK serializes this to:
 * -c 'sandbox_permissions=["disk-full-read-access"]'
 *
 * @param {string[]|null|undefined} dirs
 * @returns {{sandbox_permissions: string[]}|null}
 */
export function buildCodexSkillReadOnlyConfig(dirs) {
  const cleanDirs = (dirs || []).filter(Boolean);
  if (cleanDirs.length === 0) {
    return null;
  }

  return { sandbox_permissions: ['disk-full-read-access'] };
}

/**
 * Codex applies a second environment policy when an agent invokes shell-like
 * tools. Its default secret-name filter removes `*TOKEN*`, so the database API
 * credential can reach the Codex process but disappear from the skill command.
 *
 * Inherit the parent environment for normal command compatibility, disable the
 * broad built-in filter, then replace it with an exact-name allow-list. Codex
 * Current Codex releases treat these entries as environment variable names,
 * so do not wrap them in regular-expression anchors: `^NAME$` is treated as a literal name
 * and filters the real variable out on Windows. All
 * other key/secret/token/password/credential variables remain unavailable to
 * shell tools; only the two database API token names are intentionally added.
 * Values are never serialized into Codex CLI config.
 *
 * @param {Record<string, string|undefined>|null|undefined} env
 * @param {{platform?: NodeJS.Platform|string}} [options]
 * @returns {{inherit: string, ignore_default_excludes: boolean, include_only: string[], set?: Record<string, string>}|null}
 */
export function buildCodexShellEnvironmentPolicy(env, options = {}) {
  const platform = options.platform || process.platform;
  const windowsSet = platform === 'win32'
    ? buildCodexWindowsShellEnvironmentSet(env || {})
    : null;
  const allowedNames = new Set(Object.entries(env || {})
    .filter(([name, value]) => (
      typeof value === 'string'
      && value.length > 0
      && (
        !CODEX_SHELL_SENSITIVE_ENV_NAME.test(name)
        || CODEX_SHELL_EXPLICITLY_ALLOWED_SECRETS.has(name.toUpperCase())
      )
    ))
    .map(([name]) => name));

  for (const name of Object.keys(windowsSet || {})) {
    allowedNames.add(name);
  }

  const sortedAllowedNames = Array.from(allowedNames)
    .sort((left, right) => left.localeCompare(right));

  if (sortedAllowedNames.length === 0) {
    return null;
  }

  return {
    inherit: 'all',
    ignore_default_excludes: true,
    include_only: sortedAllowedNames,
    ...(windowsSet ? { set: windowsSet } : {}),
  };
}

/**
 * Codex's elevated Windows runner can fail before PowerShell executes with
 * 8009001d on otherwise healthy systems. Managed MedHelp sessions already use
 * their own permission mode, so select the more compatible unelevated runner.
 *
 * @param {NodeJS.Platform|string} [platform]
 * @returns {{windows: {sandbox: string}}|null}
 */
export function buildCodexWindowsCompatibilityConfig(platform = process.platform) {
  return platform === 'win32'
    ? { windows: { sandbox: 'unelevated' } }
    : null;
}

/**
 * Build a prompt section telling Codex where MedHelp skills live and how to use
 * them lazily. Returns an empty string if no directories are available.
 *
 * @param {string[]|null|undefined} dirs
 * @returns {string}
 */
export function buildCodexSkillsPromptSection(dirs) {
  const cleanDirs = (dirs || []).filter(Boolean);
  if (cleanDirs.length === 0) {
    return '';
  }

  const bullets = cleanDirs.map((dir) => `- ${dir}`).join('\n');
  return [
    '# MedHelp Skills (available outside the project workspace)',
    '',
    'MedHelp research skills are not inside this project. They live under these',
    'absolute directories, which are available as read-only source paths:',
    bullets,
    '',
    'Each immediate subdirectory that contains a `SKILL.md` is one skill. To use a skill:',
    '1. List these directories to discover available skills (do not read them all at once).',
    '2. Read the specific `<dir>/<skill-name>/SKILL.md` for its procedure, then follow it.',
    '',
    'If a skill name appears in more than one directory, prefer the first directory listed.',
    'Do not expect `.agents/skills`, `.claude/skills`, `.codex/skills`, or a project-level',
    '`skills/` folder to exist. Always use the absolute paths above.',
  ].join('\n');
}

/**
 * Build the short periodic reminder used after the first Codex turn. This keeps
 * skill path awareness fresh without repeatedly injecting the full skill guide.
 *
 * @param {string[]|null|undefined} dirs
 * @returns {string}
 */
export function buildCodexSkillsReminderSection(dirs) {
  const cleanDirs = (dirs || []).filter(Boolean);
  if (cleanDirs.length === 0) {
    return '';
  }

  const bullets = cleanDirs.map((dir) => `- ${dir}`).join('\n');
  return [
    '# MedHelp Skills Reminder',
    '',
    'MedHelp skills are read-only and live outside this project:',
    bullets,
    '',
    'When a task asks for or would benefit from a skill, read the relevant',
    '`<dir>/<skill-name>/SKILL.md` from these absolute paths. Do not search',
    "Codex's installation directory, `.codex/skills`, `.agents/skills`, or a",
    'project-level `skills/` folder for MedHelp skills.',
  ].join('\n');
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * Resolve the one-based Codex turn number used for periodic skill reminders.
 * Unknown resumed sessions start from 2, assuming the original first turn
 * already received the full skill section.
 *
 * @param {{isFirstTurn: boolean, sessionMetadata?: object|null}} args
 * @returns {number}
 */
export function resolveCodexSkillTurnNumber({ isFirstTurn, sessionMetadata }) {
  if (isFirstTurn) {
    return 1;
  }

  const previousTurnCount = normalizePositiveInteger(sessionMetadata?.codexSkillTurnCount, 1);
  return previousTurnCount + 1;
}

/**
 * Decide whether this turn should carry a skill prompt section. The first turn
 * always gets the full section; resumed turns get a short reminder every four
 * turns by default (turn 4, 8, 12...), which lands in the requested 3-5 turn
 * cadence after the initial injection.
 *
 * @param {{isFirstTurn: boolean, turnNumber: number, interval?: number}} args
 * @returns {boolean}
 */
export function shouldInjectCodexSkillPrompt({ isFirstTurn, turnNumber, interval = CODEX_SKILL_REMINDER_INTERVAL }) {
  if (isFirstTurn) {
    return true;
  }

  const normalizedTurnNumber = normalizePositiveInteger(turnNumber, 0);
  const normalizedInterval = normalizePositiveInteger(interval, CODEX_SKILL_REMINDER_INTERVAL);
  return normalizedTurnNumber > 1 && normalizedTurnNumber % normalizedInterval === 0;
}

/**
 * Select the full first-turn skill guide or the short periodic reminder.
 *
 * @param {string[]|null|undefined} dirs
 * @param {{isFirstTurn: boolean, turnNumber: number, interval?: number}} args
 * @returns {string}
 */
export function buildCodexSkillsPromptForTurn(dirs, args) {
  const cleanDirs = (dirs || []).filter(Boolean);
  if (cleanDirs.length === 0 || !shouldInjectCodexSkillPrompt(args)) {
    return '';
  }

  return args?.isFirstTurn
    ? buildCodexSkillsPromptSection(cleanDirs)
    : buildCodexSkillsReminderSection(cleanDirs);
}

/**
 * Assemble the prompt sent to Codex for one turn.
 *
 * Project instructions are injected only on the first turn of a new Codex
 * thread. Skill prompts can also be injected on periodic resumed turns as a
 * short reminder, so resumed turns still honor `skillsSection` when present.
 *
 * @param {object} args
 * @param {boolean} args.isFirstTurn
 * @param {string} [args.skillsSection]
 * @param {string} args.instructedCommand
 * @param {string} args.plainCommand
 * @returns {string}
 */
export function assembleCodexTurnPrompt({
  isFirstTurn,
  skillsSection,
  instructedCommand,
  plainCommand,
}) {
  const section = String(skillsSection ?? '').trim();
  const base = String((isFirstTurn ? instructedCommand : plainCommand) ?? '');
  return section ? `${section}\n\n${base}` : base;
}
