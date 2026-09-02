import { describe, expect, it } from 'vitest';

import { formatWorkbenchCommandPrompt } from './workbenchCommand';

describe('workbench command prompt', () => {
  it('keeps visible text and adds stable entity metadata for the agent', () => {
    const prompt = formatWorkbenchCommandPrompt({
      prompt: '帮我准备这次组会',
      entity: { kind: 'meeting', id: 'meeting-7' },
      skills: ['medhelp-workbench-review', 'medhelp-workbench-review'],
    });

    expect(prompt).toContain('帮我准备这次组会');
    expect(prompt).toContain('<medhelp_workbench_selection>');
    expect(prompt).toContain('"id":"meeting-7"');
    expect(prompt.match(/medhelp-workbench-review/g)).toHaveLength(1);
  });

  it('does not add metadata tags when no structured context exists', () => {
    expect(formatWorkbenchCommandPrompt({ prompt: '普通请求' })).toBe('普通请求');
  });
});
