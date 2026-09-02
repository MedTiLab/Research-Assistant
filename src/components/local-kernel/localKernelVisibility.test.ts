import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { shouldShowLocalKernelWorkspace } from './localKernelVisibility';
import LocalKernelBoundary from './LocalKernelBoundary';

const mocks = vi.hoisted(() => ({ kernel: vi.fn() }));
vi.mock('../../state/localKernelStore', () => ({ useLocalKernel: mocks.kernel }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ logout: () => {} }) }));
vi.mock('../../utils/desktopRuntime', () => ({
  getDesktopRuntimeInfo: () => ({ isDesktopShell: true, isDesktopKernel: true }),
}));

describe('shouldShowLocalKernelWorkspace', () => {
  it('uses the transition screen for the initial Kernel probe', () => {
    expect(shouldShowLocalKernelWorkspace({
      isRequired: true,
      state: 'probing',
      hasConnected: false,
    })).toBe(false);
  });

  it('keeps the workspace mounted during a background reconnect probe', () => {
    expect(shouldShowLocalKernelWorkspace({
      isRequired: true,
      state: 'probing',
      hasConnected: true,
    })).toBe(true);
  });

  it('shows the recovery gate after a reconnect actually fails', () => {
    expect(shouldShowLocalKernelWorkspace({
      isRequired: true,
      state: 'offline',
      hasConnected: true,
    })).toBe(false);
  });

  it('shows an actionable initial desktop authorization failure instead of project loaders', () => {
    mocks.kernel.mockReturnValue({ isRequired: true, state: 'offline', error: 'Online authentication was rejected', retry: async () => {} });
    const html = renderToStaticMarkup(createElement(LocalKernelBoundary, null, 'PROJECT_LOADER'));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Online authentication was rejected');
    expect(html).toContain('重试连接');
    expect(html).toContain('退出并重新登录');
    expect(html).not.toContain('PROJECT_LOADER');
    expect(html).not.toContain('animate-spin');
  });

  it.each(['probing', 'connected', 'not-required'])('preserves desktop shell content for %s', (state) => {
    mocks.kernel.mockReturnValue({ isRequired: state !== 'not-required', state, retry: async () => {} });
    expect(renderToStaticMarkup(createElement(LocalKernelBoundary, null, 'WORKSPACE'))).toBe('WORKSPACE');
  });
});
