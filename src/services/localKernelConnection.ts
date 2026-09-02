import type { LocalKernelEndpoint } from './localKernelClient';

export type ActiveLocalKernel = {
  httpBaseUrl: string;
  sessionToken: string;
};

let activeLocalKernel: ActiveLocalKernel | null = null;

export function setActiveLocalKernel(
  endpoint: LocalKernelEndpoint | null,
  sessionToken: string | null,
): void {
  activeLocalKernel = endpoint && sessionToken
    ? { httpBaseUrl: endpoint.httpBaseUrl, sessionToken }
    : null;
}

export function getActiveLocalKernel(): ActiveLocalKernel | null {
  return activeLocalKernel;
}
