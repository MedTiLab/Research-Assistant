export type WorkbenchEntity = {
  kind: 'meeting' | 'action' | 'note';
  id: string;
};

export type WorkbenchCommand = {
  prompt: string;
  entity?: WorkbenchEntity;
  skills?: string[];
};

export function formatWorkbenchCommandPrompt(command: WorkbenchCommand): string {
  const prompt = command.prompt.trim();
  const metadata = {
    ...(command.entity ? { entity: command.entity } : {}),
    ...(command.skills?.length ? { skills: [...new Set(command.skills)] } : {}),
  };
  if (Object.keys(metadata).length === 0) return prompt;
  return [
    prompt,
    '',
    '<medhelp_workbench_selection>',
    JSON.stringify(metadata),
    '</medhelp_workbench_selection>',
  ].join('\n');
}
