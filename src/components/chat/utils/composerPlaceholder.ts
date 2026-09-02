export type ComposerPlaceholderKind =
  | 'attachedPrompt'
  | 'workspaceQa'
  | 'connectedProject'
  | 'researchStage'
  | 'fallback';

export function resolveComposerPlaceholderKind(input: {
  hasAttachedPromptPlaceholder: boolean;
  isEmpty: boolean;
  sessionMode?: string | null;
  hasConnectedProjectFolder: boolean;
  hasResearchStage: boolean;
}): ComposerPlaceholderKind {
  if (input.hasAttachedPromptPlaceholder) {
    return 'attachedPrompt';
  }
  if (!input.isEmpty) {
    return 'fallback';
  }
  if (input.sessionMode === 'workspace_qa') {
    return 'workspaceQa';
  }
  if (input.hasConnectedProjectFolder) {
    return 'connectedProject';
  }
  if (input.sessionMode === 'research' && input.hasResearchStage) {
    return 'researchStage';
  }
  return 'fallback';
}
