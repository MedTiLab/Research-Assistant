import type { ProviderAvailability } from '../types/types';

export interface PiActiveSelection {
  modelId: string;
  modelProviderId: string;
  modelApi: string;
}

interface PiSelectionTarget {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  setModelId: (value: string) => void;
  setModelProviderId: (value: string) => void;
  setModelApi: (value: string) => void;
}

const text = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

/**
 * Settings controls which API/models are available, not which enabled model
 * the user must choose for every turn. Keep a remembered choice only when it
 * is still in the active account's catalogue (including API and protocol).
 */
export function getAuthoritativePiSelection(
  availability: ProviderAvailability | undefined,
  remembered?: PiActiveSelection,
): PiActiveSelection | null {
  const modelId = text(availability?.modelId);
  const modelProviderId = text(availability?.modelProviderId);
  const modelApi = text(availability?.modelApi);
  if (availability?.configured !== true || !modelId || !modelProviderId || !modelApi) {
    return null;
  }
  if (remembered && availability.models?.some((model) => (
    model.value === remembered.modelId
    && model.modelProviderId === remembered.modelProviderId
    && model.modelApi === remembered.modelApi
  ))) return remembered;
  return { modelId, modelProviderId, modelApi };
}

export function applyAuthoritativePiSelection(
  availability: ProviderAvailability | undefined,
  target: PiSelectionTarget,
): boolean {
  const selection = getAuthoritativePiSelection(availability, {
    modelId: target.storage.getItem('pi-model') || '',
    modelProviderId: target.storage.getItem('pi-model-provider') || '',
    modelApi: target.storage.getItem('pi-model-api') || '',
  });
  if (!selection) return false;

  target.setModelId(selection.modelId);
  target.setModelProviderId(selection.modelProviderId);
  target.setModelApi(selection.modelApi);
  target.storage.setItem('pi-model', selection.modelId);
  target.storage.setItem('pi-model-provider', selection.modelProviderId);
  target.storage.setItem('pi-model-api', selection.modelApi);
  return true;
}
