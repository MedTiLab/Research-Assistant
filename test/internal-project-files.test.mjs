import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isInternalProjectPath,
  isProtectedProjectPath,
} from '../shared/internalProjectFiles.js';
import {
  classifyWorkspaceArchiveEntry,
} from '../server/routes/projects.js';

test('protects agent instructions and skill directories from project file APIs', () => {
  const protectedPaths = [
    'AGENTS.md',
    'server/AGENTS.md',
    'CLAUDE.md',
    'CODEX.md',
    'GEMINI.md',
    'skills/example/SKILL.md',
    'agent-harness/SKILL.md',
    '.agents/skills/example/SKILL.md',
    '.claude/settings.json',
    '.codex/skills/example/SKILL.md',
    '.gemini/skills/example/SKILL.md',
    '.medhelpsec/MEMORY.md',
  ];

  for (const relativePath of protectedPaths) {
    assert.equal(isProtectedProjectPath(relativePath), true, relativePath);
    assert.equal(isInternalProjectPath(relativePath), true, relativePath);
  }
});

test('keeps workflow state internal without treating it as protected skills', () => {
  const internalWorkflowPaths = [
    'instance.json',
    'pipeline_config.json',
    '.pipeline/docs/research_brief.json',
  ];

  for (const relativePath of internalWorkflowPaths) {
    assert.equal(isInternalProjectPath(relativePath), true, relativePath);
    assert.equal(isProtectedProjectPath(relativePath), false, relativePath);
  }
});

test('excludes protected agent assets from workspace archive downloads', () => {
  const protectedArchiveEntries = [
    'skills/example/SKILL.md',
    'agent-harness/SKILL.md',
    '.codex/skills/example/SKILL.md',
    'server/AGENTS.md',
  ];

  for (const relativePath of protectedArchiveEntries) {
    assert.deepEqual(
      classifyWorkspaceArchiveEntry(relativePath, { isDirectory: false }),
      { include: false, reason: 'protected_agent_assets' },
      relativePath,
    );
  }

  assert.deepEqual(
    classifyWorkspaceArchiveEntry('Publication/manuscript/main.md', { isDirectory: false }),
    { include: true },
  );
});
