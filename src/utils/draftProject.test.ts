import { describe, expect, it } from 'vitest';

import type { Project } from '../types/app';
import {
  resolvePreferredConversationFolder,
  shouldCreateConversationWorkspace,
} from './draftProject';

const project = (overrides: Partial<Project> = {}): Project => ({
  name: 'project-a',
  displayName: 'Project A',
  fullPath: '/workspaces/project-a',
  sessions: [],
  ...overrides,
});

describe('shouldCreateConversationWorkspace', () => {
  it('creates an isolated workspace before the first message in the default conversation', () => {
    expect(shouldCreateConversationWorkspace(
      project({ isDefaultWorkspace: true }),
      null,
    )).toBe(true);
  });

  it('keeps an existing default-workspace session resumable as a legacy conversation', () => {
    expect(shouldCreateConversationWorkspace(
      project({ isDefaultWorkspace: true }),
      { id: 'existing-session' },
    )).toBe(false);
  });

  it('does not replace a real conversation or fixed project workspace', () => {
    expect(shouldCreateConversationWorkspace(
      project({ isConversationWorkspace: true }),
      null,
    )).toBe(false);
    expect(shouldCreateConversationWorkspace(project(), null)).toBe(false);
  });
});

describe('resolvePreferredConversationFolder', () => {
  const defaultProject = project({ name: 'default', isDefaultWorkspace: true });
  const rememberedProject = project({ name: 'remembered' });
  const selectedProject = project({ name: 'selected' });

  it('prefers the currently selected real folder', () => {
    expect(resolvePreferredConversationFolder(
      [defaultProject, rememberedProject, selectedProject],
      selectedProject,
      rememberedProject.name,
    )?.name).toBe(selectedProject.name);
  });

  it('falls back to the remembered folder from the project list', () => {
    expect(resolvePreferredConversationFolder(
      [defaultProject, rememberedProject],
      defaultProject,
      rememberedProject.name,
    )?.name).toBe(rememberedProject.name);
  });

  it('does not reuse internal conversation workspaces as the default folder', () => {
    const conversationWorkspace = project({
      name: 'conversation-workspace',
      isConversationWorkspace: true,
    });
    expect(resolvePreferredConversationFolder(
      [defaultProject, conversationWorkspace],
      conversationWorkspace,
      conversationWorkspace.name,
    )).toBeNull();
  });
});
