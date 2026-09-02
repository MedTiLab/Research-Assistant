import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import WorkbenchPermissionPanel from './WorkbenchPermissionPanel';

describe('WorkbenchPermissionPanel', () => {
  it('shows the exact meeting title and time without offering permanent approval', () => {
    const html = renderToStaticMarkup(<WorkbenchPermissionPanel
      request={{
        requestId: 'request-1',
        toolName: 'mcp__medhelp_workbench__meeting_create',
        input: { title: '课题进展汇报', meetingDate: '2026-09-05T14:00:00.000Z' },
      }}
      onDecision={vi.fn()}
    />);

    expect(html).toContain('课题进展汇报');
    expect(html).toContain('2026-09-05T14:00:00.000Z');
    expect(html).toContain('确认本次写入');
    expect(html).not.toContain('remember');
    expect(html).not.toContain('永久');
  });

  it('shows the action text before promoting a note', () => {
    const html = renderToStaticMarkup(<WorkbenchPermissionPanel
      request={{
        requestId: 'request-2',
        toolName: 'mcp__medhelp_workbench__note_promote',
        input: { noteId: 'note-1', content: '周五前完成补充分析' },
      }}
      onDecision={vi.fn()}
    />);
    expect(html).toContain('周五前完成补充分析');
    expect(html).toContain('将生成的行动项');
  });
});
