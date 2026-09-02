import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In a normal source checkout this file lives at <repo>/server/utils/, so the
// repo root is two levels up. In the compiled SEA Kernel the esbuild banner
// rewrites import.meta.url to the executable path, which makes __dirname point
// at <runtime>/bin instead — the relative hops below are meaningless there.
// Every asset root therefore has to be given explicitly by the launcher.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function fromEnv(name) {
  const raw = process.env[name];
  return raw && raw.trim() ? path.resolve(raw.trim()) : null;
}

/**
 * Directory holding the bundled MedHelp skills (one subdirectory per skill,
 * each containing SKILL.md).
 */
export function resolveSystemSkillsDir() {
  return fromEnv('MEDHELP_SKILLS_DIR') || path.join(REPO_ROOT, 'skills');
}

/**
 * Directory holding the agent rule templates (CLAUDE.md, AGENTS.md).
 * These must exist as real files: callers symlink to them and pass their paths
 * to the Codex CLI, so an embedded string would not be enough.
 */
export function resolveAgentTemplatesDir() {
  return fromEnv('MEDHELP_TEMPLATES_DIR') || path.join(REPO_ROOT, 'server', 'templates');
}

/**
 * True when the process is the compiled single-file Kernel, where the relative
 * fallbacks above cannot work and the env vars are mandatory.
 */
export function isSecureDistribution() {
  return process.env.MEDHELP_SECURE_DISTRIBUTION === '1';
}
