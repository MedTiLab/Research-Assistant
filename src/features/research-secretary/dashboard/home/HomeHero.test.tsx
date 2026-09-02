import { describe, expect, it, vi } from 'vitest';
import HomeHero from './HomeHero';
import { createWorkbenchI18n, renderWorkbench } from '../../renderWithI18n';

const now = new Date(2026, 8, 2, 23, 10, 0);

const props = {
  now,
  focus: '',
  goal: '',
  onFocusChange: vi.fn(),
  onGoalChange: vi.fn(),
  onSave: vi.fn(),
  saved: false,
  runningAgentCount: 0,
  isSyncing: false,
  syncError: null,
  onOpenChat: vi.fn(),
};

describe('HomeHero localization', () => {
  it('keeps the Chinese chrome when the app language is Chinese', async () => {
    const i18n = await createWorkbenchI18n('zh-CN');
    const markup = renderWorkbench(<HomeHero {...props} />, i18n);

    expect(markup).toContain('研究生 AI 助理');
    expect(markup).toContain('今日焦点');
    expect(markup).toContain('今日目标');
    expect(markup).toContain('保存');
    expect(markup).toContain('计划只保存在本机，不会离开这台设备');
    expect(markup).toContain('对话');
  });

  it('renders English chrome when the app language is English', async () => {
    const i18n = await createWorkbenchI18n('en');
    const markup = renderWorkbench(<HomeHero {...props} />, i18n);

    expect(markup).toContain('Graduate AI Assistant');
    expect(markup).toContain("Today&#x27;s focus");
    expect(markup).toContain("Today&#x27;s goal");
    expect(markup).toContain('Save');
    expect(markup).toContain('The plan stays on this device and never leaves it');
    expect(markup).toContain('Chat');
    expect(markup).not.toContain('研究生 AI 助理');
    expect(markup).not.toContain('今日焦点');
    expect(markup).not.toContain('保存');
  });
});
