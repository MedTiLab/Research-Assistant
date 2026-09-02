import { describe, expect, it } from 'vitest';

import {
  isLocalBrowserHostname,
  isLoopbackBrowserHostname,
  isPrivateNetworkBrowserHostname,
  resolveLocalKernelRequired,
} from '../utils/localKernelRequired';

describe('local Kernel required routing', () => {
  it('treats browser loopback hosts as local app surfaces', () => {
    expect(isLoopbackBrowserHostname('localhost')).toBe(true);
    expect(isLoopbackBrowserHostname('dev.localhost')).toBe(true);
    expect(isLoopbackBrowserHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackBrowserHostname('127.12.34.56')).toBe(true);
    expect(isLoopbackBrowserHostname('[::1]')).toBe(true);
    expect(isLoopbackBrowserHostname('app.medtimehelp.com')).toBe(false);
  });

  it('treats LAN and private-network hosts as local app surfaces', () => {
    expect(isPrivateNetworkBrowserHostname('192.168.1.20')).toBe(true);
    expect(isPrivateNetworkBrowserHostname('10.0.0.5')).toBe(true);
    expect(isPrivateNetworkBrowserHostname('172.16.4.8')).toBe(true);
    expect(isPrivateNetworkBrowserHostname('172.31.255.255')).toBe(true);
    expect(isPrivateNetworkBrowserHostname('172.32.0.1')).toBe(false);
    expect(isPrivateNetworkBrowserHostname('medhelp.local')).toBe(true);
    expect(isLocalBrowserHostname('192.168.1.20')).toBe(true);
    expect(isLocalBrowserHostname('app.medtimehelp.com')).toBe(false);
  });

  it('requires the local Kernel by default on hosted login pages', () => {
    expect(resolveLocalKernelRequired({}, {
      protocol: 'https:',
      hostname: 'app.medtimehelp.com',
    })).toBe(true);
  });

  it('does not require the local Kernel by default on localhost', () => {
    expect(resolveLocalKernelRequired({}, {
      protocol: 'http:',
      hostname: '127.0.0.1',
    })).toBe(false);
  });

  it('does not require the local Kernel by default on LAN server URLs', () => {
    expect(resolveLocalKernelRequired({}, {
      protocol: 'http:',
      hostname: '192.168.1.20',
    })).toBe(false);
    expect(resolveLocalKernelRequired({}, {
      protocol: 'http:',
      hostname: 'medhelp.local',
    })).toBe(false);
  });

  it('lets explicit runtime flags override hostname defaults', () => {
    expect(resolveLocalKernelRequired({ VITE_REQUIRE_LOCAL_KERNEL: 'true' }, {
      protocol: 'http:',
      hostname: '127.0.0.1',
    })).toBe(true);
    expect(resolveLocalKernelRequired({ VITE_MEDHELP_ALLOW_SERVER_PROJECTS: 'true' }, {
      protocol: 'https:',
      hostname: 'app.medtimehelp.com',
    })).toBe(false);
  });
});
