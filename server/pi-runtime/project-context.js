import { promises as fs } from 'fs';
import path from 'path';
import { resolveAgentTemplatesDir } from '../utils/kernelAssetPaths.js';

const PROJECT_CONTEXT_FILES = Object.freeze([
  { name: 'AGENTS.md', maxBytes: 64 * 1024, kind: 'instructions' },
  { name: 'CLAUDE.md', maxBytes: 64 * 1024, kind: 'instructions' },
  { name: 'README.md', maxBytes: 24 * 1024, kind: 'project_description' },
]);
const MAX_PROJECT_CONTEXT_BYTES = 96 * 1024;
const MAX_SYSTEM_RULES_BYTES = 64 * 1024;

function isWithinRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export async function loadPiProjectContext(projectRoot) {
  const canonicalRoot = await fs.realpath(path.resolve(projectRoot));
  const items = [];
  let remainingBytes = MAX_PROJECT_CONTEXT_BYTES;
  let systemRules = '';

  // MedHelp's platform rules are part of Pi's hidden system prompt. They are
  // deliberately loaded from the bundled runtime assets rather than copied
  // into the user's project or exposed as a project context item.
  try {
    const systemRulesPath = path.join(resolveAgentTemplatesDir(), 'AGENTS.md');
    const handle = await fs.open(systemRulesPath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_SYSTEM_RULES_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      systemRules = buffer
        .subarray(0, Math.min(bytesRead, MAX_SYSTEM_RULES_BYTES))
        .toString('utf8')
        .trim();
    } finally {
      await handle.close();
    }
  } catch (error) {
    console.warn('[Pi project context] Failed to read bundled system rules:', error?.message || error);
  }

  for (const candidate of PROJECT_CONTEXT_FILES) {
    if (remainingBytes <= 0) break;
    const requestedPath = path.join(canonicalRoot, candidate.name);
    try {
      const canonicalPath = await fs.realpath(requestedPath);
      if (!isWithinRoot(canonicalRoot, canonicalPath)) continue;
      const stat = await fs.stat(canonicalPath);
      if (!stat.isFile()) continue;
      const allowedBytes = Math.min(candidate.maxBytes, remainingBytes);
      const handle = await fs.open(canonicalPath, 'r');
      try {
        const buffer = Buffer.alloc(allowedBytes + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const truncated = bytesRead > allowedBytes;
        const content = buffer.subarray(0, Math.min(bytesRead, allowedBytes)).toString('utf8').trim();
        if (!content) continue;
        // New MedHelp projects may link their root AGENTS.md to the same
        // bundled template. Do not spend context twice on identical rules.
        if (candidate.name === 'AGENTS.md' && content === systemRules) continue;
        const usedBytes = Buffer.byteLength(content);
        remainingBytes -= usedBytes;
        items.push({
          id: `project-context:${candidate.name.toLowerCase()}`,
          type: candidate.kind,
          path: candidate.name,
          content,
          truncated,
          bytes: usedBytes,
        });
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[Pi project context] Failed to read ${candidate.name}:`, error?.message || error);
      }
    }
  }

  const systemRulesPrompt = systemRules
    ? [
      '<medhelp_system_rules>',
      systemRules,
      '</medhelp_system_rules>',
    ].join('\n')
    : '';
  const projectContextPrompt = items.length === 0
    ? ''
    : [
      '<medhelp_project_context>',
      'Treat the following files as trusted project instructions and project description. More specific user instructions still take precedence.',
      ...items.flatMap((item) => [
        `<context_file path="${item.path}" kind="${item.type}"${item.truncated ? ' truncated="true"' : ''}>`,
        item.content,
        '</context_file>',
      ]),
      '</medhelp_project_context>',
    ].join('\n');
  const prompt = [systemRulesPrompt, projectContextPrompt].filter(Boolean).join('\n\n');

  return { projectRoot: canonicalRoot, items, prompt };
}
