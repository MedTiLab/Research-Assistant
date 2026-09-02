import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import zhChat from '../../../../i18n/locales/zh-CN/chat.json';
import ChatTaskProgressPill from './ChatTaskProgressPill';
import { applyPiAttachmentDelivery, piAttachmentReason } from '../../utils/piAttachmentDelivery';
import { convertSessionMessages } from '../../utils/messageTransforms';

const taskContext = vi.hoisted(() => ({ tasks: [] as Array<Record<string, unknown>>, isLoadingTasks: false }));
vi.mock('../../../../contexts/TaskMasterContext', () => ({ useTaskMaster: () => taskContext }));
beforeEach(() => { taskContext.tasks = []; });
const i18n = createInstance();
beforeAll(async () => { await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { chat: zhChat } } }); });
const renderProgress = (props: React.ComponentProps<typeof ChatTaskProgressPill>) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}><ChatTaskProgressPill {...props} /></I18nextProvider>,
);

describe('Pi session status presentation', () => {
  it.each(['pi', 'claude', 'codex'])('shows only the original project task progress for %s', (provider) => {
    taskContext.tasks = [{ id: 'done', title: 'Finished project task', status: 'done' }, { id: 'active', title: 'Project analysis', status: 'in-progress' }];
    const html = renderProgress({ provider, compact: true, expanded: true });
    expect(html).toContain('Project analysis');
    expect(html).toContain('aria-label="项目任务进度"');
    expect(html).toContain('aria-valuemax="2" aria-valuenow="1"');
    expect(html.match(/role="group"/g)).toHaveLength(1);
    expect(html).not.toContain('会话待办');
    expect(html).not.toContain('Agent 独立任务');
  });
  it.each(['pi', 'claude', 'codex'])('hides the empty project progress for %s without adding a session card', (provider) => {
    expect(renderProgress({ provider, hideWhenEmpty: true })).toBe('');
  });
  it('retains attachment delivery feedback through live updates and history conversion', () => {
    const delivery = [{ name: 'paper.pdf', path: '/project/paper.pdf', status: 'not_sent', reason: 'unsupported_type' }];
    const [live] = applyPiAttachmentDelivery([{ type: 'user', content: 'Read paper', timestamp: 1 }], delivery);
    const [history] = convertSessionMessages([{ role: 'user', content: 'Read paper', attachmentDelivery: delivery }]);
    expect(live.attachmentDelivery).toEqual(history.attachmentDelivery);
    expect(piAttachmentReason('image_too_large')).toContain('8 MB');
    expect(piAttachmentReason('total_image_limit')).toContain('20 MB');
    expect(piAttachmentReason('model_no_vision')).toContain('不支持视觉');
  });
});
