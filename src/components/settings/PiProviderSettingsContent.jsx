import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Database,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  KeyRound,
  ListFilter,
  Loader2,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  Radio,
  RefreshCcw,
  Trash2,
  Video,
  Volume2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  getPiProviderPreset,
  PI_DOMESTIC_PROVIDER_PRESETS,
  PI_OFFICIAL_PROVIDER_PRESETS,
} from '../../../shared/piProviderPresets.js';
import {
  inferPiModelCapabilities,
  isPiAgentCapabilityCallable,
} from '../../../shared/piModelCapabilities.js';
import { authenticatedFetch } from '../../utils/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  canTestPiProviderForm,
  canTestSavedPiProvider,
  changePiProviderFormType,
  createPiProviderForm,
  getPiVendorSelectionValue,
  PI_CUSTOM_VENDOR_ID,
  piProviderTestMessageKey,
  piProviderTestPayload,
} from './piProviderFormState.js';
import {
  getPiModelCapabilitySection,
  modelSupportsPiCapabilitySection,
  orderModelsForPiCapabilitySection,
  PI_MODEL_CAPABILITY_SECTIONS,
} from './piModelCapabilitySections.js';

const PRESET_REGION_ORDER = ['official', 'china', 'chinaSubscription', 'global', 'globalSubscription'];

const MODEL_CAPABILITY_ICONS = {
  chat: MessageSquare,
  realtime_conversation: Radio,
  speech_recognition: Mic,
  speech_synthesis: Volume2,
  vision: Eye,
  image_generation: ImageIcon,
  image_edit: Pencil,
  video_generation: Video,
  embedding: Database,
  rerank: ListFilter,
};

const DEFAULT_TASK_PROTOCOLS = {
  chat: 'provider.chat',
  realtime_conversation: 'provider.realtime',
  image_generation: 'openai.images',
  image_edit: 'openai.images',
  video_generation: 'provider.video',
  speech_synthesis: 'openai.audio_speech',
  speech_recognition: 'openai.audio_transcriptions',
  embedding: 'openai.embeddings',
  rerank: 'provider.rerank',
};

const CAPABILITY_PROTOCOL_SUGGESTIONS = Object.freeze({
  image_generation: ['openai.images', 'gemini.generate_content', 'stepfun.images', 'ark.images'],
  image_edit: ['openai.images', 'gemini.generate_content', 'stepfun.images', 'ark.images'],
  speech_synthesis: ['openai.audio_speech', 'stepfun.audio_speech', 'minimax.t2a', 'mimo.chat_tts'],
  speech_recognition: ['openai.audio_transcriptions', 'stepfun.asr_sse', 'mimo.chat_asr'],
});

const defaultCapabilityForTask = (task) => ({
  task,
  traits: [],
  protocol: DEFAULT_TASK_PROTOCOLS[task] || `provider.${task}`,
  enabled: true,
});

const defaultPiRequest = (path, options) => authenticatedFetch(`/api/pi${path}`, options);

async function readPayload(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error?.message || payload.error || `Request failed (${response.status})`);
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

export default function PiProviderSettingsContent({
  mode,
  request = defaultPiRequest,
  onConfigurationChange,
}) {
  const { t } = useTranslation('settings');
  const [providers, setProviders] = useState([]);
  const [activeProviderId, setActiveProviderId] = useState(null);
  const [selectedProviderId, setSelectedProviderId] = useState(null);
  const [form, setForm] = useState(() => createPiProviderForm());
  const [showForm, setShowForm] = useState(false);
  const [models, setModels] = useState([]);
  const [activeModelId, setActiveModelId] = useState(null);
  const [activeModelIds, setActiveModelIds] = useState({});
  const [manualModelId, setManualModelId] = useState('');
  const [selectedModelSectionId, setSelectedModelSectionId] = useState('chat');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [savedTestResults, setSavedTestResults] = useState({});
  const [error, setError] = useState(null);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) || null,
    [providers, selectedProviderId],
  );
  const selectedProviderPreset = useMemo(
    () => getPiProviderPreset(selectedProvider?.presetId),
    [selectedProvider?.presetId],
  );
  const selectedFormPreset = useMemo(
    () => getPiProviderPreset(form.presetId),
    [form.presetId],
  );
  const configuredPresetIds = useMemo(
    () => new Set(providers.map((provider) => provider.presetId).filter(Boolean)),
    [providers],
  );
  const selectedModelSection = useMemo(
    () => getPiModelCapabilitySection(selectedModelSectionId),
    [selectedModelSectionId],
  );
  const selectedSectionModels = useMemo(
    () => models.filter((model) => modelSupportsPiCapabilitySection(model, selectedModelSection)),
    [models, selectedModelSection],
  );
  const orderedSectionModels = useMemo(
    () => orderModelsForPiCapabilitySection(models, selectedModelSection),
    [models, selectedModelSection],
  );

  const notifyChanged = () => {
    window.dispatchEvent(new Event('pi-provider-config-changed'));
    onConfigurationChange?.();
  };

  const loadProviders = async () => {
    const payload = await readPayload(await request('/providers'));
    setProviders(payload.providers || []);
    setActiveProviderId(payload.activeProviderId || null);
    setSelectedProviderId((current) => (
      (payload.providers || []).some((provider) => provider.id === current)
        ? current
        : (payload.activeProviderId || payload.providers?.[0]?.id || null)
    ));
    return payload;
  };

  const loadModels = async (providerId) => {
    if (!providerId) {
      setModels([]);
      setActiveModelId(null);
      setActiveModelIds({});
      return;
    }
    const payload = await readPayload(await request(`/providers/${encodeURIComponent(providerId)}/models`));
    setModels(payload.models || []);
    setActiveModelId(payload.activeModelId || null);
    setActiveModelIds(payload.activeModelIds || { chat: payload.activeModelId || null });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadProviders()
      .catch((nextError) => {
        if (!cancelled) setError(nextError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [request]);

  useEffect(() => {
    if (mode !== 'models') return;
    setError(null);
    loadModels(selectedProviderId).catch((nextError) => setError(nextError.message));
  }, [mode, request, selectedProviderId]);

  const resetForm = () => {
    setForm(createPiProviderForm());
    setTestResult(null);
    setShowForm(false);
  };

  const startProviderForm = (presetId = null) => {
    setForm(createPiProviderForm(presetId));
    setTestResult(null);
    setShowForm(true);
  };

  const updateForm = (updater) => {
    setForm(updater);
    setTestResult(null);
  };

  const changeProviderType = (providerType) => {
    updateForm((current) => changePiProviderFormType(current, providerType));
  };

  const editProvider = (provider) => {
    setForm({
      id: provider.id,
      presetId: provider.presetId || null,
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      apiKey: '',
      modelApi: provider.modelApi,
      enabled: provider.enabled,
    });
    setTestResult(null);
    setShowForm(true);
  };

  const connectionTestOutcome = (payload) => ({
    ok: true,
    message: payload.modelCount > 0
      ? t('piProvider.api.testSuccess', { count: payload.modelCount })
      : t('piProvider.api.testSuccessNoModels'),
  });

  const connectionTestFailure = (nextError) => ({
    ok: false,
    message: t(piProviderTestMessageKey(nextError.code, nextError.message), {
      message: nextError.message,
    }),
  });

  const runConnectionTest = async (payload) => {
    setError(null);
    const result = await readPayload(await request('/providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    return connectionTestOutcome(result);
  };

  const testProvider = async () => {
    if (!canTestPiProviderForm(form) || testing || testingProviderId || busy) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await runConnectionTest(piProviderTestPayload(form)));
    } catch (nextError) {
      setTestResult(connectionTestFailure(nextError));
    } finally {
      setTesting(false);
    }
  };

  const testSavedProvider = async (provider) => {
    if (!canTestSavedPiProvider(provider) || testing || testingProviderId || busy) return;
    setTestingProviderId(provider.id);
    setSavedTestResults((current) => {
      const next = { ...current };
      delete next[provider.id];
      return next;
    });
    try {
      const result = await runConnectionTest(piProviderTestPayload(provider));
      setSavedTestResults((current) => ({ ...current, [provider.id]: result }));
    } catch (nextError) {
      setSavedTestResults((current) => ({
        ...current,
        [provider.id]: connectionTestFailure(nextError),
      }));
    } finally {
      setTestingProviderId(null);
    }
  };

  const saveProvider = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { ...form };
      if (!payload.apiKey) delete payload.apiKey;
      await readPayload(await request('/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      await loadProviders();
      resetForm();
      notifyChanged();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  };

  const mutateProvider = async (path, options = {}) => {
    setBusy(true);
    setError(null);
    try {
      await readPayload(await request(path, options));
      await loadProviders();
      notifyChanged();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  };

  const addManualModel = () => {
    const id = manualModelId.trim();
    if (!id || models.some((model) => model.id === id)) return;
    const inferredCapabilities = inferPiModelCapabilities(selectedProvider || {}, id);
    let capabilities = [
      inferredCapabilities.find((capability) => capability.task === selectedModelSection.task)
        || defaultCapabilityForTask(selectedModelSection.task),
    ];
    if (selectedModelSection.trait) {
      capabilities = capabilities.map((capability) => (
        capability.task === selectedModelSection.task
          ? { ...capability, traits: [...new Set([...(capability.traits || []), selectedModelSection.trait])] }
          : capability
      ));
    }
    setModels((current) => [...current, {
      id,
      label: id,
      api: selectedProvider?.modelApi || 'openai-completions',
      contextWindow: 128000,
      maxTokens: 16384,
      reasoning: capabilities.some((capability) => capability.traits?.includes('reasoning')),
      vision: capabilities.some((capability) => capability.traits?.includes('vision_input')),
      capabilities,
      enabled: true,
      source: 'manual',
    }]);
    if (capabilities.some((capability) => capability.task === 'chat')) {
      setActiveModelId((current) => current || id);
      setActiveModelIds((current) => ({ ...current, chat: current.chat || id }));
    }
    setManualModelId('');
  };

  const saveModels = async () => {
    if (!selectedProviderId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await readPayload(await request(`/providers/${encodeURIComponent(selectedProviderId)}/models`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models, activeModelId: activeModelIds.chat || activeModelId, activeModelIds }),
      }));
      setModels(payload.models || []);
      setActiveModelId(payload.activeModelId || null);
      setActiveModelIds(payload.activeModelIds || { chat: payload.activeModelId || null });
      await loadProviders();
      notifyChanged();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  };

  const refreshModels = async () => {
    if (!selectedProviderId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await readPayload(await request(
        `/providers/${encodeURIComponent(selectedProviderId)}/models/refresh`,
        { method: 'POST' },
      ));
      setModels(payload.models || []);
      setActiveModelId(payload.activeModelId || null);
      setActiveModelIds(payload.activeModelIds || { chat: payload.activeModelId || null });
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleModelTask = (model, task, enabled) => {
    setModels((current) => current.map((entry) => {
      if (entry.id !== model.id) return entry;
      const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : [];
      if (!enabled) {
        if (capabilities.length <= 1) return entry;
        return { ...entry, capabilities: capabilities.filter((capability) => capability.task !== task) };
      }
      if (capabilities.some((capability) => capability.task === task)) return entry;
      const inferred = inferPiModelCapabilities(selectedProvider || {}, entry.id, entry)
        .find((capability) => capability.task === task);
      return {
        ...entry,
        capabilities: [...capabilities, inferred || defaultCapabilityForTask(task)],
      };
    }));
    if (enabled) {
      setActiveModelIds((current) => ({ ...current, [task]: current[task] || model.id }));
    }
  };

  const updateChatTrait = (modelId, trait, enabled) => {
    setModels((current) => current.map((entry) => {
      if (entry.id !== modelId) return entry;
      const capabilities = (entry.capabilities || []).map((capability) => {
        if (capability.task !== 'chat') return capability;
        const traits = new Set(capability.traits || []);
        if (enabled) traits.add(trait);
        else traits.delete(trait);
        return { ...capability, traits: [...traits] };
      });
      return {
        ...entry,
        capabilities,
        ...(trait === 'reasoning' ? { reasoning: enabled } : {}),
        ...(trait === 'vision_input' ? { vision: enabled } : {}),
      };
    }));
  };

  const updateModelCapability = (modelId, task, patch) => {
    setModels((current) => current.map((entry) => (
      entry.id !== modelId
        ? entry
        : {
          ...entry,
          capabilities: (entry.capabilities || []).map((capability) => (
            capability.task === task ? { ...capability, ...patch } : capability
          )),
        }
    )));
  };

  const toggleVisionModel = (model, enabled) => {
    setModels((current) => current.map((entry) => {
      if (entry.id !== model.id) return entry;
      let capabilities = Array.isArray(entry.capabilities) ? [...entry.capabilities] : [];
      let chat = capabilities.find((capability) => capability.task === 'chat');
      if (!chat && enabled) {
        chat = inferPiModelCapabilities(selectedProvider || {}, entry.id, entry)
          .find((capability) => capability.task === 'chat') || defaultCapabilityForTask('chat');
        capabilities.push(chat);
      }
      capabilities = capabilities.map((capability) => {
        if (capability.task !== 'chat') return capability;
        const traits = new Set(capability.traits || []);
        if (enabled) traits.add('vision_input');
        else traits.delete('vision_input');
        return { ...capability, traits: [...traits] };
      });
      return { ...entry, capabilities, vision: enabled };
    }));
  };

  const toggleSelectedModelSection = (model, enabled) => {
    if (selectedModelSection.trait === 'vision_input') {
      toggleVisionModel(model, enabled);
      return;
    }
    toggleModelTask(model, selectedModelSection.task, enabled);
  };

  const providerSectionCount = (provider, section) => {
    if (!provider) return 0;
    if (provider.id === selectedProviderId) {
      return models.filter((model) => (
        model.enabled !== false && modelSupportsPiCapabilitySection(model, section)
      )).length;
    }
    return Number(provider.capabilityModelCounts?.[section.id]
      ?? provider.taskModelCounts?.[section.task]
      ?? 0);
  };

  const totalSectionCount = (section) => providers.reduce(
    (total, provider) => total + providerSectionCount(provider, section),
    0,
  );

  const selectModelSection = (section) => {
    setSelectedModelSectionId(section.id);
    if (providerSectionCount(selectedProvider, section) > 0) return;
    const matchingProvider = providers.find((provider) => providerSectionCount(provider, section) > 0);
    if (matchingProvider) setSelectedProviderId(matchingProvider.id);
  };

  if (loading) {
    return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('piProvider.loading')}</div>;
  }

  if (mode === 'models') {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-foreground">{t('piProvider.models.title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('piProvider.models.description')}</p>
        </div>

        {providers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('piProvider.models.noProvider')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-background md:flex">
            <aside className="border-b border-border bg-muted/25 p-2 md:w-56 md:flex-shrink-0 md:border-b-0 md:border-r">
              <div className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('piProvider.models.byCapability')}
              </div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-1">
                {PI_MODEL_CAPABILITY_SECTIONS.map((section) => {
                  const Icon = MODEL_CAPABILITY_ICONS[section.id] || Database;
                  const count = totalSectionCount(section);
                  const selected = selectedModelSection.id === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => selectModelSection(section)}
                      aria-pressed={selected}
                      className={`flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${selected
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {t(`piProvider.models.sections.${section.id}`)}
                      </span>
                      <span className={`text-xs tabular-nums ${selected ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="min-w-0 flex-1 space-y-4 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <label className="block min-w-0 flex-1 space-y-1 text-xs font-medium text-foreground">
                  <span>{t('piProvider.models.provider')}</span>
                  <select
                    value={selectedProviderId || ''}
                    onChange={(event) => setSelectedProviderId(event.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} · {providerSectionCount(provider, selectedModelSection)}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedProviderPreset?.discoverModels === false ? (
                  <div className="flex h-10 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
                    {t('piProvider.models.presetCatalogIncluded')}
                  </div>
                ) : (
                  <Button type="button" variant="outline" onClick={refreshModels} disabled={busy}>
                    <RefreshCcw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />{t('piProvider.models.discover')}
                  </Button>
                )}
              </div>

              <section className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-foreground">
                        {t(`piProvider.models.sections.${selectedModelSection.id}`)}
                      </h4>
                      <Badge variant="secondary">
                        {t(`piProvider.models.runtime.${selectedModelSection.runtime}`)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(`piProvider.models.sectionDescriptions.${selectedModelSection.id}`)}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('piProvider.models.configuredCount', { count: selectedSectionModels.length })}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {providers.map((provider) => {
                    const count = providerSectionCount(provider, selectedModelSection);
                    if (count === 0) return null;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => setSelectedProviderId(provider.id)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${provider.id === selectedProviderId
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                      >
                        {provider.name} · {count}
                      </button>
                    );
                  })}
                  {totalSectionCount(selectedModelSection) === 0 && (
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      {t('piProvider.models.noConfiguredProviderForCapability')}
                    </span>
                  )}
                </div>

                {!selectedModelSection.trait && selectedSectionModels.length > 0 && (
                  <label className="mt-4 block max-w-xl space-y-1 text-xs font-medium text-foreground">
                    <span>{t('piProvider.models.defaultForCapability')}</span>
                    <select
                      value={activeModelIds[selectedModelSection.task] || selectedSectionModels[0]?.id || ''}
                      onChange={(event) => {
                        setActiveModelIds((current) => ({
                          ...current,
                          [selectedModelSection.task]: event.target.value,
                        }));
                        if (selectedModelSection.task === 'chat') setActiveModelId(event.target.value);
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {selectedSectionModels.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedModelSection.trait && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    {t('piProvider.models.visionRoutingHelp')}
                  </div>
                )}
              </section>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={manualModelId}
                  onChange={(event) => setManualModelId(event.target.value)}
                  placeholder={t('piProvider.models.manualCapabilityPlaceholder', {
                    capability: t(`piProvider.models.sections.${selectedModelSection.id}`),
                  })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addManualModel();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addManualModel} disabled={!manualModelId.trim()}>
                  <Plus className="mr-2 h-4 w-4" />{t('piProvider.models.addManual')}
                </Button>
              </div>

              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {models.length === 0 ? (
                  <div className="p-5 text-center text-sm text-muted-foreground">{t('piProvider.models.empty')}</div>
                ) : orderedSectionModels.map((model, modelIndex) => {
                  const configured = modelSupportsPiCapabilitySection(model, selectedModelSection);
                  const capability = model.capabilities?.find((entry) => entry.task === selectedModelSection.task);
                  const agentCallable = isPiAgentCapabilityCallable(capability);
                  return (
                    <div key={model.id} className={`space-y-3 p-3 ${configured ? 'bg-background' : 'bg-muted/15'}`}>
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={configured}
                          onChange={(event) => toggleSelectedModelSection(model, event.target.checked)}
                          aria-label={t('piProvider.models.assignCapability', {
                            model: model.label,
                            capability: t(`piProvider.models.sections.${selectedModelSection.id}`),
                          })}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate font-medium text-foreground">{model.label}</div>
                            <Badge variant={configured ? 'secondary' : 'outline'}>
                              {configured ? t('piProvider.models.configured') : t('piProvider.models.notConfigured')}
                            </Badge>
                            {configured && selectedModelSection.runtime === 'agent' && (
                              <Badge variant={agentCallable ? 'secondary' : 'outline'}>
                                {agentCallable
                                  ? t('piProvider.models.agentCallable')
                                  : t('piProvider.models.adapterRequired')}
                              </Badge>
                            )}
                            {!model.enabled && <Badge variant="outline">{t('piProvider.api.disabled')}</Badge>}
                          </div>
                          <div className="truncate font-mono text-xs text-muted-foreground">{model.id}</div>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={model.enabled}
                            onChange={(event) => setModels((current) => current.map((entry) => (
                              entry.id === model.id ? { ...entry, enabled: event.target.checked } : entry
                            )))}
                            aria-label={t('piProvider.models.enableModel', { model: model.label })}
                          />
                          {t('piProvider.models.enabled')}
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setModels((current) => current.filter((entry) => entry.id !== model.id));
                            if (activeModelId === model.id) setActiveModelId(null);
                            setActiveModelIds((current) => Object.fromEntries(
                              Object.entries(current).map(([task, value]) => [task, value === model.id ? null : value]),
                            ));
                          }}
                          aria-label={t('piProvider.models.removeModel', { model: model.label })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {configured && selectedModelSection.task === 'chat' && selectedModelSection.id === 'chat' && (
                        <div className="flex flex-wrap gap-4 border-t border-border/60 pt-3">
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={model.reasoning === true}
                              onChange={(event) => updateChatTrait(model.id, 'reasoning', event.target.checked)}
                            />
                            {t('piProvider.models.reasoning')}
                          </label>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={model.vision === true}
                              onChange={(event) => updateChatTrait(model.id, 'vision_input', event.target.checked)}
                            />
                            {t('piProvider.models.vision')}
                          </label>
                        </div>
                      )}

                      {configured && selectedModelSection.runtime === 'agent' && (
                        <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
                          <label className="space-y-1 text-xs font-medium text-foreground">
                            <span>{t('piProvider.models.capabilityProtocol')}</span>
                            <Input
                              value={capability?.protocol || ''}
                              list={`pi-capability-protocol-${selectedModelSection.task}-${modelIndex}`}
                              onChange={(event) => updateModelCapability(
                                model.id,
                                selectedModelSection.task,
                                { protocol: event.target.value },
                              )}
                              placeholder={t('piProvider.models.capabilityProtocolPlaceholder')}
                            />
                            <datalist id={`pi-capability-protocol-${selectedModelSection.task}-${modelIndex}`}>
                              {(CAPABILITY_PROTOCOL_SUGGESTIONS[selectedModelSection.task] || []).map((protocol) => (
                                <option key={protocol} value={protocol} />
                              ))}
                            </datalist>
                          </label>
                          <label className="space-y-1 text-xs font-medium text-foreground">
                            <span>{t('piProvider.models.capabilityEndpoint')}</span>
                            <Input
                              value={capability?.endpoint || ''}
                              onChange={(event) => updateModelCapability(
                                model.id,
                                selectedModelSection.task,
                                { endpoint: event.target.value },
                              )}
                              placeholder={t('piProvider.models.capabilityEndpointPlaceholder')}
                            />
                          </label>
                          <p className="text-xs text-muted-foreground sm:col-span-2">
                            {t('piProvider.models.customCapabilityHelp')}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <Button onClick={saveModels} disabled={busy || models.length === 0}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  {t('piProvider.models.save')}
                </Button>
              </div>
            </div>
          </div>
        )}
        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-medium text-foreground">{t('piProvider.api.title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('piProvider.api.description')}</p>
        </div>
        <Button type="button" onClick={() => startProviderForm()}>
          <Plus className="mr-2 h-4 w-4" />{t('piProvider.api.addCustom')}
        </Button>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
        <div>
          <h4 className="font-medium text-foreground">{t('piProvider.api.domesticTitle')}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{t('piProvider.api.domesticDescription')}</p>
        </div>
        <label className="block space-y-2 text-sm font-medium text-foreground">
          <span>{t('piProvider.api.domesticSelectLabel')}</span>
          <select
            value={getPiVendorSelectionValue(form, showForm)}
            onChange={(event) => {
              const presetId = event.target.value;
              if (!presetId) return;
              if (presetId === PI_CUSTOM_VENDOR_ID) {
                startProviderForm();
                return;
              }
              const configuredProvider = providers.find((provider) => provider.presetId === presetId);
              if (configuredProvider) {
                editProvider(configuredProvider);
                return;
              }
              startProviderForm(presetId);
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t('piProvider.api.domesticSelectPlaceholder')}</option>
            <option value={PI_CUSTOM_VENDOR_ID}>{t('piProvider.api.customVendor')}</option>
            {PRESET_REGION_ORDER.map((region) => {
              const presets = region === 'official'
                ? PI_OFFICIAL_PROVIDER_PRESETS
                : PI_DOMESTIC_PROVIDER_PRESETS.filter((preset) => preset.region === region);
              if (presets.length === 0) return null;
              return (
                <optgroup key={region} label={t(`piProvider.api.presetRegions.${region}`)}>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {configuredPresetIds.has(preset.id)
                        ? `${preset.name} · ${t('piProvider.api.presetAdded')} · ${t('piProvider.api.presetModelCount', { count: preset.models.length })}`
                        : `${preset.name} · ${t('piProvider.api.presetModelCount', { count: preset.models.length })}`}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      </section>

      <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-100">
        <div className="flex gap-2"><KeyRound className="mt-0.5 h-4 w-4 flex-shrink-0" /><span>{t('piProvider.api.secretNotice')}</span></div>
      </div>

      {showForm && (
        <form onSubmit={saveProvider} className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
          {selectedFormPreset && (
            <div className="flex flex-col gap-2 rounded-md border border-violet-200 bg-violet-50/60 p-3 text-sm text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-100 sm:flex-row sm:items-center sm:justify-between">
              <span>{t('piProvider.api.presetIncludes', { name: selectedFormPreset.name, count: selectedFormPreset.models.length })}</span>
              <a
                href={selectedFormPreset.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-shrink-0 items-center gap-1 font-medium underline underline-offset-2"
              >
                {t('piProvider.api.getApiKey')}<ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>{t('piProvider.api.name')}</span>
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>
            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>{t('piProvider.api.type')}</span>
              <select
                value={form.providerType}
                onChange={(event) => changeProviderType(event.target.value)}
                disabled={selectedFormPreset?.id === 'official-gemini'}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="byok-openai-compatible">
                  {selectedFormPreset?.id === 'official-gemini'
                    ? t('piProvider.api.geminiType')
                    : t('piProvider.api.remoteType')}
                </option>
                <option value="byok-anthropic-compatible">{t('piProvider.api.anthropicType')}</option>
                <option value="local-openai-compatible">{t('piProvider.api.localType')}</option>
              </select>
            </label>
          </div>
          <label className="block space-y-2 text-sm font-medium text-foreground">
            <span>{t('piProvider.api.baseUrl')}</span>
            <Input
              value={form.baseUrl}
              onChange={(event) => updateForm((current) => ({ ...current, baseUrl: event.target.value }))}
              required
            />
          </label>
          <label className="block space-y-2 text-sm font-medium text-foreground">
            <span>{t('piProvider.api.protocol')}</span>
            <select
              value={form.modelApi}
              onChange={(event) => updateForm((current) => ({ ...current, modelApi: event.target.value }))}
              disabled={selectedFormPreset?.id === 'official-gemini'}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {selectedFormPreset?.id === 'official-gemini' ? (
                <option value="openai-completions">{t('piProvider.api.geminiGenerateContent')}</option>
              ) : form.providerType === 'byok-anthropic-compatible' ? (
                <option value="anthropic-messages">{t('piProvider.api.anthropicMessages')}</option>
              ) : (
                <>
                  <option value="openai-completions">{t('piProvider.api.chatCompletions')}</option>
                  <option value="openai-responses">{t('piProvider.api.responses')}</option>
                </>
              )}
            </select>
          </label>
          <label className="block space-y-2 text-sm font-medium text-foreground">
            <span>{form.id ? t('piProvider.api.replaceKey') : t('piProvider.api.apiKey')}</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(event) => updateForm((current) => ({ ...current, apiKey: event.target.value }))}
              required={!form.id && form.providerType !== 'local-openai-compatible'}
              placeholder={form.id
                ? t('piProvider.api.keepKeyPlaceholder')
                : (form.providerType === 'byok-anthropic-compatible' ? 'sk-ant-...' : 'sk-...')}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
            {t('piProvider.api.enabled')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {testResult && (
              <div
                className={`text-sm sm:mr-auto ${testResult.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'}`}
              >
                {testResult.message}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={testProvider}
                disabled={testing || Boolean(testingProviderId) || busy || !canTestPiProviderForm(form)}
              >
                {testing
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Radio className="mr-2 h-4 w-4" />}
                {testing ? t('piProvider.api.testing') : t('piProvider.api.test')}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>{t('piProvider.cancel')}</Button>
              <Button type="submit" disabled={busy || testing || Boolean(testingProviderId)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('piProvider.save')}</Button>
            </div>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {providers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('piProvider.api.empty')}</div>
        ) : providers.map((provider) => (
          <div key={provider.id} className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{provider.name}</span>
                  <Badge variant="outline">
                    {provider.presetId === 'official-gemini'
                      ? t('piProvider.api.geminiBadge')
                      : provider.providerType === 'byok-anthropic-compatible'
                      ? t('piProvider.api.claudeBadge')
                      : t('piProvider.api.openAIBadge')}
                  </Badge>
                  {provider.id === activeProviderId && <Badge variant="secondary">{t('piProvider.api.active')}</Badge>}
                  {!provider.enabled && <Badge variant="secondary">{t('piProvider.api.disabled')}</Badge>}
                </div>
                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{provider.baseUrl}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {provider.keyConfigured
                    ? t('piProvider.api.keyConfigured', { last4: provider.keyLast4 || 'local' })
                    : t('piProvider.api.keyMissing')}
                  {' · '}{t('piProvider.api.modelCount', { count: provider.enabledModelCount })}
                </div>
                {savedTestResults[provider.id] && (
                  <div className={`mt-2 text-xs ${savedTestResults[provider.id].ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'}`}
                  >
                    {savedTestResults[provider.id].message}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || testing || Boolean(testingProviderId) || !canTestSavedPiProvider(provider)}
                  onClick={() => testSavedProvider(provider)}
                >
                  {testingProviderId === provider.id
                    ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    : <Radio className="mr-1 h-3.5 w-3.5" />}
                  {testingProviderId === provider.id ? t('piProvider.api.testing') : t('piProvider.api.test')}
                </Button>
                {provider.id !== activeProviderId && provider.enabled && (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => mutateProvider(`/providers/${encodeURIComponent(provider.id)}/active`, { method: 'PUT' })}>
                    {t('piProvider.api.use')}
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => editProvider(provider)} aria-label={t('piProvider.api.edit')}><Pencil className="h-4 w-4" /></Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t('piProvider.api.deleteConfirm', { name: provider.name }))) {
                      mutateProvider(`/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' });
                    }
                  }}
                  aria-label={t('piProvider.api.delete')}
                ><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
