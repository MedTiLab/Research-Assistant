import { api } from './api';
import { fetchWithLocalNetworkAccess } from './localNetworkAccess';

export function buildComputeApi(localKernel) {
  const localBase = localKernel?.state === 'connected'
    ? localKernel.endpoint?.httpBaseUrl
    : null;
  const localToken = localKernel?.state === 'connected'
    ? localKernel.sessionToken
    : null;

  if (!localBase || !localToken) {
    return api.compute;
  }

  const localFetch = (path, options = {}) => {
    const url = `${localBase}/api/local/compute${path}`;
    return fetchWithLocalNetworkAccess(url, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
        Authorization: `Bearer ${localToken}`,
      },
    });
  };

  return {
    getNodes: () => localFetch('/nodes'),
    addNode: (node) => localFetch('/nodes', { method: 'POST', body: JSON.stringify(node) }),
    updateNode: (id, node) => localFetch(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(node) }),
    deleteNode: (id) => localFetch(`/nodes/${id}`, { method: 'DELETE' }),
    setActive: (id) => id
      ? localFetch(`/nodes/${id}/active`, { method: 'POST' })
      : localFetch('/active', { method: 'POST', body: JSON.stringify({ nodeId: null }) }),
    testNode: (id) => localFetch(`/nodes/${id}/test`, { method: 'POST' }),
    syncNode: (id, direction, cwd) => localFetch(`/nodes/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify({ direction, cwd }),
    }),
    runOnNode: (id, command, cwd, skipSync) => localFetch(`/nodes/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ command, cwd, skipSync }),
    }),
    slurmInfo: (id) => localFetch(`/nodes/${id}/slurm/info`),
    slurmQueue: (id) => localFetch(`/nodes/${id}/slurm/queue`),
    slurmSalloc: (id, opts) => localFetch(`/nodes/${id}/slurm/salloc`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
    slurmSbatch: (id, opts) => localFetch(`/nodes/${id}/slurm/sbatch`, {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
    slurmCancel: (id, jobId) => localFetch(`/nodes/${id}/slurm/cancel/${jobId}`, { method: 'POST' }),
    monitorNode: (id) => localFetch(`/nodes/${id}/monitor`),
    getConfig: () => localFetch('/config'),
    configure: (config) => localFetch('/configure', { method: 'POST', body: JSON.stringify(config) }),
    test: () => localFetch('/test', { method: 'POST' }),
    sync: (direction, cwd) => localFetch('/sync', {
      method: 'POST',
      body: JSON.stringify({ direction, cwd }),
    }),
    run: (command, cwd, skipSync) => localFetch('/run', {
      method: 'POST',
      body: JSON.stringify({ command, cwd, skipSync }),
    }),
    status: () => localFetch('/status'),
  };
}
