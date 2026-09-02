import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PlanApprovalPanel from './PlanApprovalPanel';

describe('Plan approval panel', () => {
  it('displays the exact revision and explicit approve/revise actions', () => {
    const markup = renderToStaticMarkup(<PlanApprovalPanel request={{ requestId: 'request', toolName: 'ExitPlanMode', input: { title: 'Implementation', plan: 'First verify the data.', revision: 3 } }} onDecision={() => {}} />);
    expect(markup).toContain('First verify the data.');
    expect(markup).toContain('v3');
    expect(markup).toContain('批准计划并继续');
    expect(markup).toContain('退回修改');
    expect(markup).toContain('仍需单独确认');
  });
  it('cannot approve an empty plan and does not render executable raw HTML', () => {
    const empty = renderToStaticMarkup(<PlanApprovalPanel request={{ requestId: 'request', toolName: 'ExitPlanMode', input: {} }} onDecision={() => {}} />);
    expect(empty).toContain('disabled');
    const unsafe = renderToStaticMarkup(<PlanApprovalPanel request={{ requestId: 'request', toolName: 'ExitPlanMode', input: { plan: '<script>alert(1)</script>' } }} onDecision={() => {}} />);
    expect(unsafe).not.toContain('<script>');
  });
});
