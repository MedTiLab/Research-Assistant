import { getActiveLocalKernel } from '../services/localKernelConnection';
import { resolveLocalKernelRequired } from './localKernelRequired';

const CLOUD_ONLY_PREFIXES = [
  '/api/auth',
  '/api/local-kernel',
  '/api/user',
  '/api/conversations',
  '/api/settings',
  '/api/gateway',
  '/api/shares',
];

export type ApiTarget = {
  url: string;
  localSessionToken: string | null;
};

export type ApiTargetOptions = {
  forceCloud?: boolean;
};

export class LocalKernelRequiredApiError extends Error {
  code = 'LOCAL_KERNEL_REQUIRED';
  path: string;

  constructor(path: string) {
    super(`Local Engine is required before calling ${path}`);
    this.name = 'LocalKernelRequiredApiError';
    this.path = path;
  }
}

function getCloudApiBase(): string {
  if (typeof window !== 'undefined') {
    const configured = (window as unknown as { __MEDHELP_CLOUD_API_BASE__?: string }).__MEDHELP_CLOUD_API_BASE__;
    if (configured) {
      return configured;
    }
  }
  return '';
}

export function resolveApiTarget(input: string, options: ApiTargetOptions = {}): ApiTarget {
  if (!input.startsWith('/api/')) {
    return { url: input, localSessionToken: null };
  }

  const cloudBase = getCloudApiBase();
  if (options.forceCloud) {
    return { url: `${cloudBase}${input}`, localSessionToken: null };
  }

  if (CLOUD_ONLY_PREFIXES.some((prefix) => (
    input === prefix || input.startsWith(`${prefix}/`) || input.startsWith(`${prefix}?`)
  ))) {
    return { url: `${cloudBase}${input}`, localSessionToken: null };
  }

  const local = getActiveLocalKernel();
  if (local) {
    return { url: `${local.httpBaseUrl}${input}`, localSessionToken: local.sessionToken };
  }

  const desktopMode = typeof window === 'undefined' ? null : window.medhelpDesktop?.uiMode;
  if (desktopMode === 'offline' || desktopMode === 'hosted' || resolveLocalKernelRequired()) {
    throw new LocalKernelRequiredApiError(input);
  }

  return { url: `${cloudBase}${input}`, localSessionToken: null };
}
