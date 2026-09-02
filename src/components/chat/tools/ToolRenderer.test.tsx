import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ToolRenderer } from './ToolRenderer';

const renderShellTool = (toolName: string, autoExpandTools: boolean) => renderToStaticMarkup(
  <ToolRenderer
    toolName={toolName}
    toolInput={{ command: 'printf a-very-long-command' }}
    mode="input"
    autoExpandTools={autoExpandTools}
  />,
);

describe('ToolRenderer automatic expansion preference', () => {
  it('renders a persistent terminal id, status and output instead of hiding a successful result', () => {
    const markup = renderToStaticMarkup(<ToolRenderer toolName="TerminalRead" toolInput={{ terminal_id: 'pty-1' }} toolResult={{ content: JSON.stringify({ terminal_id: 'pty-1', status: 'running', output: 'still working' }) }} mode="result" autoExpandTools />);
    expect(markup).toContain('pty-1');
    expect(markup).toContain('running');
    expect(markup).toContain('still working');
  });
  it('renders the formal plan body after session restoration', () => {
    const markup = renderToStaticMarkup(<ToolRenderer toolName="PlanRead" toolInput={{}} toolResult={{ content: JSON.stringify({ plan: 'Verify the implementation', status: 'approved' }) }} mode="result" autoExpandTools />);
    expect(markup).toContain('Verify the implementation');
  });
  it.each(['Bash', 'bash', 'run_shell_command'])(
    'renders %s as a collapsed, click-to-expand card when automatic expansion is off',
    (toolName) => {
      const markup = renderShellTool(toolName, false);

      expect(markup).toContain('<details');
      expect(markup).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    },
  );

  it('opens the shell command card when automatic expansion is on', () => {
    const markup = renderShellTool('Bash', true);

    expect(markup).toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
  });

  it('shows the command in the collapsed shell card summary', () => {
    const markup = renderShellTool('Bash', false);

    expect(markup).toContain('printf a-very-long-command');
    expect(markup).not.toContain('Shell command');
    expect(markup).toContain('inline-block w-fit max-w-full');
  });

  it('uses the full row for an expanded shell card', () => {
    const markup = renderShellTool('Bash', true);

    expect(markup).toContain('block w-full');
    expect(markup).not.toContain('inline-block w-fit max-w-full');
  });

  it('uses a shell tool description as the summary when one is available', () => {
    const markup = renderToStaticMarkup(
      <ToolRenderer
        toolName="Bash"
        toolInput={{ command: 'npm test', description: 'Run the test suite' }}
        mode="input"
        autoExpandTools={false}
      />,
    );

    expect(markup).toContain('Run the test suite');
  });

  it('normalizes multiline commands for the collapsed summary', () => {
    const markup = renderToStaticMarkup(
      <ToolRenderer
        toolName="Bash"
        toolInput={{ cmd: 'npm test\n-- --runInBand' }}
        mode="input"
        autoExpandTools={false}
      />,
    );

    expect(markup).toContain('npm test -- --runInBand');
  });

  it('overrides a tool-level open default when automatic expansion is off', () => {
    const markup = renderToStaticMarkup(
      <ToolRenderer
        toolName="AskUserQuestion"
        toolInput={{ questions: [{ header: 'Choice', question: 'Continue?', options: [] }] }}
        mode="input"
        autoExpandTools={false}
      />,
    );

    expect(markup).toContain('<details');
    expect(markup).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
  });
});
