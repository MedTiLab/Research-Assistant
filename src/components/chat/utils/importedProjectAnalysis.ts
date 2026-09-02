import type { Provider, ProviderAvailability } from '../types/types';

export const ANALYSIS_PROVIDERS: Array<{ id: Provider; label: string }> = [
  { id: 'pi', label: 'medhelpOS' },
];

type AnalysisModelOption = {
  value: string;
  label: string;
  modelProviderId?: string;
  modelApi?: string;
};

export function getImportedProjectAnalysisModels(
  provider: Provider,
  availability?: ProviderAvailability,
): AnalysisModelOption[] {
  if (provider !== 'pi' || availability?.configured !== true) return [];
  return (availability.models || []).map((model) => ({
    ...model,
    label: model.label || model.value,
  }));
}

export function canStartImportedProjectAnalysis(
  provider: Provider,
  model: string,
  availability?: ProviderAvailability,
): boolean {
  if (!model || availability?.cliAvailable === false || availability?.planLocked === true) return false;
  if (provider !== 'pi') return false;
  return getImportedProjectAnalysisModels(provider, availability).some((option) => (
    option.value === model && Boolean(option.modelProviderId && option.modelApi)
  ));
}
