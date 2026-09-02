import { describe, expect, it } from 'vitest';
import { ANALYSIS_PROVIDERS, canStartImportedProjectAnalysis, getImportedProjectAnalysisModels } from './importedProjectAnalysis';
import type { ProviderAvailability } from '../types/types';

const pi: ProviderAvailability = {
  cliAvailable: true,
  configured: true,
  models: [
    { value: 'active/default', label: 'Active / Default', modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions' },
    { value: 'active/chosen', label: 'Active / Chosen', modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions' },
  ],
};

describe('imported project analysis', () => {
  it('offers only Pi, with the active API model identities intact', () => {
    expect(ANALYSIS_PROVIDERS.map((provider) => provider.id)).toEqual(['pi']);
    expect(getImportedProjectAnalysisModels('pi', pi)).toEqual(pi.models);
    expect(canStartImportedProjectAnalysis('pi', 'active/chosen', pi)).toBe(true);
    expect(canStartImportedProjectAnalysis('pi', 'previous-api/chosen', pi)).toBe(false);
  });

  it.each([
    undefined,
    { ...pi, configured: false },
    { ...pi, cliAvailable: false },
    { ...pi, models: [] },
    { ...pi, models: undefined },
    { ...pi, models: [{ value: 'active/chosen', modelProviderId: '', modelApi: '' }] },
  ])('does not submit Pi before an executable model is available: %j', (availability) => {
    expect(canStartImportedProjectAnalysis('pi', 'active/chosen', availability)).toBe(false);
  });

  it('does not substitute Claude models when Pi is unconfigured', () => {
    expect(getImportedProjectAnalysisModels('pi')).toEqual([]);
    expect(getImportedProjectAnalysisModels('pi', { ...pi, configured: false })).toEqual([]);
  });

  it('rejects removed providers', () => {
    expect(getImportedProjectAnalysisModels('claude')).toEqual([]);
    expect(getImportedProjectAnalysisModels('codex')).toEqual([]);
    expect(canStartImportedProjectAnalysis('codex', 'gpt', { cliAvailable: true })).toBe(false);
    expect(canStartImportedProjectAnalysis('claude', 'sonnet', { cliAvailable: true })).toBe(false);
  });
});
