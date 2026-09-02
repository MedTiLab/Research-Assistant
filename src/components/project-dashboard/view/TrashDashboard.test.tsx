import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import type { TrashProject } from '../../../types/app';
import common from '../../../i18n/locales/zh-CN/common.json';
import sidebar from '../../../i18n/locales/zh-CN/sidebar.json';
import TrashDashboard from './TrashDashboard';

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { common, sidebar } } });
});
const project: TrashProject = {
  name: 'project-one', displayName: '研究项目', fullPath: '/work/one', originalPath: '/original/one',
  trashedAt: '2026-08-28T00:00:00Z', sessionCount: 3, canRestore: true, filesExist: true,
};
const render = (projects: TrashProject[], isLoading = false) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}><TrashDashboard projects={projects} onRefresh={() => {}} isLoading={isLoading} /></I18nextProvider>,
);

describe('project trash display', () => {
  it('identifies each project by name, original path, deletion time and conversation count', () => {
    const markup = render([project, { ...project, name: 'project-two', originalPath: '/original/two' }]);
    expect(markup.match(/<h3\b/g)).toHaveLength(2);
    expect(markup).toContain('/original/one');
    expect(markup).toContain('/original/two');
    expect(markup).toContain('删除于');
    expect(markup).toContain('3 个对话');
    expect(markup.match(/恢复项目/g)).toHaveLength(2);
    expect(markup).not.toContain('Deleted Sessions');
  });

  it('retains project cards during a background refresh', () => {
    expect(render([project], true)).toContain('/original/one');
    expect(render([], true)).not.toContain('回收站为空');
    expect(render([])).toContain('回收站为空');
  });

  it('uses the full path and project identity when display metadata is missing', () => {
    const markup = render([{ ...project, displayName: '', originalPath: undefined }]);
    expect(markup).toContain('project-one');
    expect(markup).toContain('/work/one');
  });

  it('keeps missing-file projects identifiable but disables their restore action', () => {
    const markup = render([{ ...project, filesExist: false, canRestore: false }]);
    expect(markup).toContain('项目文件已不存在');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?恢复项目<\/button>/);
  });
});
