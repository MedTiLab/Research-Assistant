import type { Project } from '../../../types/app';
import { getActiveLocalKernel } from '../../../services/localKernelConnection';
import { authenticatedFetch } from '../../../utils/api';

export type AutomationStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export type AutomationModel = {
  modelId: string;
  modelProviderId: string;
  modelApi: string;
};

export type AutomationModelOption = AutomationModel & {
  label: string;
};

export type AutomationRecord = {
  id: string;
  title: string;
  prompt: string;
  status: AutomationStatus;
  intervalMinutes: number | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastError?: string | null;
  lastSessionId?: string;
  model?: AutomationModel | null;
  projectKey: string;
};

export async function automationRequestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload as T;
}

export async function listAutomationRecords(projects: Project[]) {
  const results = await Promise.allSettled(projects.map(async (project) => {
    const rows = await automationRequestJson<Omit<AutomationRecord, 'projectKey'>[]>(
      `/api/agent-services/automations?projectKey=${encodeURIComponent(project.name)}`,
    );
    return rows.map((row) => ({ ...row, projectKey: project.name }));
  }));
  const records = results
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt));
  return {
    records,
    failures: results.filter((result): result is PromiseRejectedResult => result.status === 'rejected'),
  };
}

export async function listAutomationModels(): Promise<AutomationModelOption[]> {
  const endpoint = getActiveLocalKernel() ? '/api/local/pi/models' : '/api/pi/models';
  const response = await authenticatedFetch(endpoint, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as {
    models?: Array<{ value?: string; id?: string; label?: string; modelProviderId?: string; modelApi?: string }>;
    error?: string | { message?: string };
  };
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : payload.error?.message;
    throw new Error(message || `模型列表加载失败（${response.status}）`);
  }
  return (payload.models || []).flatMap((model) => {
    const modelId = String(model.value || model.id || '').trim();
    const modelProviderId = String(model.modelProviderId || '').trim();
    const modelApi = String(model.modelApi || '').trim();
    if (!modelId || !modelProviderId || !modelApi) return [];
    return [{ modelId, modelProviderId, modelApi, label: String(model.label || modelId) }];
  });
}
