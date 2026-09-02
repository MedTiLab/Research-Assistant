import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, Plus, Search, X } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import { getActiveLocalKernel } from '../../../../services/localKernelConnection';
import { isCodexExecutableModel } from '../../../../../shared/modelConstants';

type ModelOption = {
  value: string;
  label: string;
  contextLength?: number | null;
  isCustom?: boolean;
  modelProviderId?: string | null;
  modelApi?: string | null;
  catalogRevision?: number | null;
  free?: boolean;
};

export type ModelCatalogMeta = {
  health?: 'healthy' | 'degraded' | 'disabled' | 'rate_limited' | 'unavailable' | null;
  catalogRevision?: number | null;
  retryAt?: string | null;
  privacyNotice?: string | null;
  priceNotice?: string | null;
};

const cachedModelsByEndpoint = new Map<string, ModelOption[]>();

function getModelOptionKey(model: ModelOption) {
  return `${model.modelProviderId || ''}\u0000${model.value}`;
}

function mergeModelOptions(...modelLists: ModelOption[][]) {
  const byValue = new Map<string, ModelOption>();

  for (const modelList of modelLists) {
    for (const model of modelList || []) {
      const value = model.value?.trim();
      if (!value) {
        continue;
      }

      const key = getModelOptionKey({ ...model, value });
      const existing = byValue.get(key);
      byValue.set(key, {
        ...existing,
        ...model,
        value,
        label: model.label || existing?.label || value,
        contextLength: model.contextLength ?? existing?.contextLength ?? null,
      });
    }
  }

  return Array.from(byValue.values());
}

export function formatCompactModelName(label: string | null | undefined) {
  const trimmed = String(label || '').trim();
  if (!trimmed) return '';

  const withoutNotes = trimmed.replace(/\s*\([^)]*\)/g, '').trim() || trimmed;
  const titledParts = withoutNotes.split(/\s\/\s/);
  if (titledParts.length > 1) {
    return titledParts[titledParts.length - 1].trim();
  }

  if (!withoutNotes.includes(' ') && withoutNotes.includes('/')) {
    return withoutNotes.slice(withoutNotes.lastIndexOf('/') + 1) || withoutNotes;
  }

  return withoutNotes;
}

export function resolveModelOptions(endpoint: string, catalog: ModelOption[] | null, fallback: ModelOption[]) {
  // Once loaded, Pi's active API catalogue is authoritative, including an empty
  // list. Never reinsert a disabled model or a previous API via the fallback.
  return endpoint === '/api/pi/models'
    ? mergeModelOptions(catalog ?? fallback)
    : mergeModelOptions(catalog || [], fallback);
}

interface CustomModelInputProps {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  endpoint?: string;
  customStorageKey?: string;
  fallbackValue?: string;
  searchPlaceholder?: string;
  customPlaceholder?: string;
  toggleOptions?: ModelOption[];
  allowCustom?: boolean;
  onOptionChange?: (option: ModelOption) => void;
  selectedModelProviderId?: string | null;
  onCatalogChange?: (catalog: ModelCatalogMeta) => void;
}

export default function CustomModelInput({
  value,
  options: fallbackOptions,
  onChange,
  endpoint = '/api/settings/codex-models',
  customStorageKey = 'custom-models',
  fallbackValue,
  searchPlaceholder = 'Search models...',
  customPlaceholder = 'e.g. provider/model-name',
  toggleOptions,
  allowCustom = true,
  onOptionChange,
  selectedModelProviderId,
  onCatalogChange,
}: CustomModelInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState(() => ({
    endpoint,
    models: cachedModelsByEndpoint.get(endpoint) ?? null,
  }));
  const [loading, setLoading] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const onCatalogChangeRef = useRef(onCatalogChange);
  onCatalogChangeRef.current = onCatalogChange;
  const isCodexModelEndpoint = endpoint === '/api/settings/codex-models';
  const allowModel = (modelId?: string | null) =>
    !isCodexModelEndpoint || isCodexExecutableModel(modelId || '');
  const models = resolveModelOptions(
    endpoint,
    catalog.endpoint === endpoint ? catalog.models : cachedModelsByEndpoint.get(endpoint) ?? null,
    fallbackOptions,
  ).filter((model) => allowModel(model.value));

  const customModels: ModelOption[] = allowCustom
    ? JSON.parse(localStorage.getItem(customStorageKey) || '[]')
      .filter((model: ModelOption) => allowModel(model.value))
    : [];

  const selectModel = (model: ModelOption) => {
    onChange(model.value);
    onOptionChange?.(model);
  };

  const fetchModels = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const cachedModels = cachedModelsByEndpoint.get(endpoint);
    if (cachedModels) {
      setCatalog({ endpoint, models: cachedModels });
    }

    setLoading(true);
    try {
      const requestEndpoint = endpoint === '/api/pi/models' && getActiveLocalKernel()
        ? '/api/local/pi/models'
        : endpoint;
      const response = await authenticatedFetch(requestEndpoint);
      if (response.ok) {
        const data = await response.json();
        if (sequence !== requestSequence.current) return;
        onCatalogChangeRef.current?.({
          health: data.health || null,
          catalogRevision: Number.isInteger(data.catalogRevision) ? data.catalogRevision : null,
          retryAt: data.retryAt || null,
          privacyNotice: data.privacyNotice || null,
          priceNotice: data.priceNotice || null,
        });
        if (Array.isArray(data.models)) {
          // Cache the authoritative catalogue only; selection fallbacks are render-local.
          // Pi catalogues are account/API-specific: keep them in this instance,
          // not a module cache that survives navigation or an account change.
          if (endpoint !== '/api/pi/models') cachedModelsByEndpoint.set(endpoint, data.models);
          setCatalog({ endpoint, models: data.models });
        }
      }
    } catch {
      // Fall back to bundled options.
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void fetchModels();
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      requestSequence.current++;
      window.clearTimeout(timeout);
    };
  }, [fetchModels, open]);

  useEffect(() => {
    if (endpoint !== '/api/pi/models') return undefined;
    const invalidatePiModels = () => {
      requestSequence.current++;
      cachedModelsByEndpoint.delete(endpoint);
      setCatalog({ endpoint, models: null });
      setLoading(false);
      if (open) void fetchModels();
    };
    window.addEventListener('pi-provider-config-changed', invalidatePiModels);
    return () => window.removeEventListener('pi-provider-config-changed', invalidatePiModels);
  }, [endpoint, fetchModels, open]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setShowCustomInput(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const allModels = [
    ...customModels,
    ...models.filter((model) => !customModels.some(
      (customModel) => getModelOptionKey(customModel) === getModelOptionKey(model),
    )),
  ];

  const filteredModels = search
    ? allModels.filter((model) =>
      model.value.toLowerCase().includes(search.toLowerCase())
      || model.label.toLowerCase().includes(search.toLowerCase()))
    : allModels;

  const isSelectedModel = (option: ModelOption) => (
    option.value === value
    && (
      !selectedModelProviderId
      || !option.modelProviderId
      || option.modelProviderId === selectedModelProviderId
    )
  );
  const displayLabel = allModels.find(isSelectedModel)?.label || value;
  const compactLabel = formatCompactModelName(displayLabel);
  const directToggleOptions = (toggleOptions || []).filter((option) => option.value?.trim());
  const canToggleDirectly = directToggleOptions.length > 1;

  const handleTriggerClick = () => {
    if (canToggleDirectly) {
      const activeIndex = directToggleOptions.findIndex((option) => option.value === value);
      const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % directToggleOptions.length : 0;
      selectModel(directToggleOptions[nextIndex]);
      return;
    }

    setOpen((previous) => !previous);
  };

  const addCustomModel = () => {
    const slug = customDraft.trim();
    if (!slug || !allowModel(slug)) {
      return;
    }

    const existing: ModelOption[] = JSON.parse(localStorage.getItem(customStorageKey) || '[]');
    if (!existing.some((model) => model.value === slug)) {
      const updated = [...existing, { value: slug, label: slug, isCustom: true }];
      localStorage.setItem(customStorageKey, JSON.stringify(updated));
    }

    selectModel({ value: slug, label: slug, isCustom: true });
    setCustomDraft('');
    setShowCustomInput(false);
    setOpen(false);
  };

  const removeCustomModel = (slug: string) => {
    const existing: ModelOption[] = JSON.parse(localStorage.getItem(customStorageKey) || '[]');
    localStorage.setItem(
      customStorageKey,
      JSON.stringify(existing.filter((model) => model.value !== slug)),
    );

    if (value === slug) {
      onChange(fallbackValue || fallbackOptions[0]?.value || '');
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={handleTriggerClick}
        className="flex h-7 max-w-[12.5rem] items-center gap-1.5 rounded-lg border border-border/60 bg-white px-2 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary/30"
        aria-label={displayLabel}
        title={displayLabel}
      >
        <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {compactLabel && <span className="min-w-0 truncate">{compactLabel}</span>}
        <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !canToggleDirectly && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-[380px] max-h-[360px] bg-popover border border-border rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            {loading && <span className="text-[10px] text-muted-foreground animate-pulse">Loading...</span>}
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            {filteredModels.length === 0 && !loading && (
              <p className="px-3 py-4 text-[11px] text-muted-foreground text-center">No models found</p>
            )}

            {filteredModels.map((model) => (
              <button
                key={getModelOptionKey(model)}
                type="button"
                onClick={() => {
                  selectModel(model);
                  setOpen(false);
                  setSearch('');
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors group ${
                  isSelectedModel(model) ? 'bg-primary/8' : ''
                }`}
              >
                <span className="w-3.5 shrink-0">
                  {isSelectedModel(model) && <Check className="w-3 h-3 text-primary" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-medium text-foreground truncate">
                    {model.label}
                  </span>
                  {model.label !== model.value && (
                    <span className="block text-[9px] text-muted-foreground/60 truncate">
                      {model.value}
                    </span>
                  )}
                </span>
                {model.contextLength && (
                  <span className="text-[9px] text-muted-foreground/50 shrink-0">
                    {Math.round(model.contextLength / 1000)}k
                  </span>
                )}
                {model.isCustom && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeCustomModel(model.value);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </button>
            ))}
          </div>

          {allowCustom && <div className="border-t border-border/60 px-3 py-2">
            {showCustomInput ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={customDraft}
                  onChange={(event) => setCustomDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addCustomModel();
                    if (event.key === 'Escape') setShowCustomInput(false);
                  }}
                  placeholder={customPlaceholder}
                  className="flex-1 bg-transparent text-[11px] text-foreground border border-border/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={addCustomModel}
                  className="text-[10px] font-medium text-primary hover:text-primary/80"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add custom model
              </button>
            )}
          </div>}
        </div>
      )}
    </div>
  );
}
