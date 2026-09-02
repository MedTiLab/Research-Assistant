import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setActiveLocalKernel } from '../services/localKernelConnection';
import { LocalKernelRequiredApiError, resolveApiTarget } from './apiBase';

describe('resolveApiTarget', () => {
  beforeEach(() => setActiveLocalKernel(null, null));
  afterEach(() => vi.unstubAllGlobals());

  it('leaves absolute URLs untouched', () => {
    expect(resolveApiTarget('https://example.com/x')).toEqual({
      url: 'https://example.com/x',
      localSessionToken: null,
    });
  });

  it('keeps auth paths on the cloud even when connected', () => {
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' } as any, 'mh_loc_x');
    expect(resolveApiTarget('/api/auth/login')).toEqual({
      url: '/api/auth/login',
      localSessionToken: null,
    });
  });

  it('keeps local-kernel cloud handshake on the cloud', () => {
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' } as any, 'mh_loc_x');
    expect(resolveApiTarget('/api/local-kernel/launch-token').url).toBe('/api/local-kernel/launch-token');
  });

  it('keeps account conversation history on the cloud', () => {
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' } as any, 'mh_loc_x');
    expect(resolveApiTarget('/api/conversations?limit=50')).toEqual({
      url: '/api/conversations?limit=50',
      localSessionToken: null,
    });
  });

  it('keeps account-owned share paths on the local account service', () => {
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' } as any, 'mh_loc_x');
    expect(resolveApiTarget('/api/shares/conversations')).toEqual({
      url: '/api/shares/conversations',
      localSessionToken: null,
    });
  });

  it('routes work paths to the local Kernel when connected', () => {
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' } as any, 'mh_loc_x');
    expect(resolveApiTarget('/api/projects')).toEqual({
      url: 'http://127.0.0.1:5055/api/projects',
      localSessionToken: 'mh_loc_x',
    });
  });

  it('can force cloud routing for global inventory paths while connected', () => {
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' } as any, 'mh_loc_x');
    expect(resolveApiTarget('/api/skills', { forceCloud: true })).toEqual({
      url: '/api/skills',
      localSessionToken: null,
    });
    expect(resolveApiTarget('/api/skills/file?filePath=skill-tag-mapping.json', { forceCloud: true })).toEqual({
      url: '/api/skills/file?filePath=skill-tag-mapping.json',
      localSessionToken: null,
    });
  });

  it('falls back to cloud (same origin) when not connected', () => {
    expect(resolveApiTarget('/api/projects')).toEqual({
      url: '/api/projects',
      localSessionToken: null,
    });
  });

  it.each(['offline', 'hosted'])('never sends desktop %s workspace requests to the cloud during pairing', (uiMode) => {
    vi.stubGlobal('window', {
      location: { protocol: 'http:', hostname: '127.0.0.1' },
      medhelpDesktop: { uiMode },
    });
    expect(() => resolveApiTarget('/api/pi/projects/project/sessions/saved/branches')).toThrow(LocalKernelRequiredApiError);
    expect(resolveApiTarget('/api/auth/user').localSessionToken).toBeNull();
  });

  it('does not fall back to cloud work APIs on hosted pages that require the local Kernel', () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'https:',
        hostname: 'app.medtimehelp.com',
      },
    });

    expect(() => resolveApiTarget('/api/projects')).toThrow(LocalKernelRequiredApiError);
  });

  it('can force cloud routing for public share paths on hosted pages without a local Kernel', () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'https:',
        hostname: 'app.medtimehelp.com',
      },
    });

    expect(resolveApiTarget('/api/shares/abc', { forceCloud: true })).toEqual({
      url: '/api/shares/abc',
      localSessionToken: null,
    });
  });

  it('allows user account paths on hosted pages without a local Kernel', () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'https:',
        hostname: 'app.medtimehelp.com',
      },
    });

    expect(resolveApiTarget('/api/user/complete-onboarding')).toEqual({
      url: '/api/user/complete-onboarding',
      localSessionToken: null,
    });
  });
});
