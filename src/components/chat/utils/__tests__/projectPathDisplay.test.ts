import { describe, expect, it } from 'vitest';

import {
  formatProjectRelativePaths,
  toProjectRelativeDisplayPath,
} from '../projectPathDisplay';

describe('project path display', () => {
  const projectRoot = '/Users/demo/medhelp_workspace/u-123/mimic_ivu';

  it('replaces current project absolute paths with project-relative paths', () => {
    const text = [
      'Word 文档已生成成功：',
      `📄 ${projectRoot}/Experiment/analysis/report.docx`,
      `PDF: file://${projectRoot}/Publication/manuscript/main.pdf`,
    ].join('\n');

    expect(formatProjectRelativePaths(text, projectRoot)).toBe([
      'Word 文档已生成成功：',
      '📄 Experiment/analysis/report.docx',
      'PDF: Publication/manuscript/main.pdf',
    ].join('\n'));
  });

  it('normalizes project absolute file links to clickable relative paths', () => {
    expect(toProjectRelativeDisplayPath(`${projectRoot}/Experiment/analysis/report.docx`, projectRoot)).toBe(
      'Experiment/analysis/report.docx',
    );
    expect(toProjectRelativeDisplayPath(`file://${projectRoot}/Experiment/analysis/report.docx#L3`, projectRoot)).toBe(
      'Experiment/analysis/report.docx',
    );
  });

  it('does not rewrite paths outside the current project', () => {
    expect(formatProjectRelativePaths('/Users/demo/other/report.docx', projectRoot)).toBe('/Users/demo/other/report.docx');
  });
});
