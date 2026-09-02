import { describe, expect, it } from 'vitest';

import { encodeClaudeProjectDirName } from '../projects.js';

describe('Claude project directory compatibility', () => {
  it('matches Claude CLI directory encoding for Unicode project names', () => {
    expect(
      encodeClaudeProjectDirName('-Users-gaoyuzhen-medhelp-workspace-白癜风'),
    ).toBe('-Users-gaoyuzhen-medhelp-workspace----');
  });

  it('leaves existing ASCII project directory names unchanged', () => {
    expect(
      encodeClaudeProjectDirName('-Users-gaoyuzhen-medhelp-workspace-study-01'),
    ).toBe('-Users-gaoyuzhen-medhelp-workspace-study-01');
  });
});
