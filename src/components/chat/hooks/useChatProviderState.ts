import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  normalizeClaudeStoredModelSelection,
  normalizeCodexStoredModelSelection,
} from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode, Provider } from '../types/types';
import type { ProjectSession, SessionProvider } from '../../../types/app';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

const DEFAULT_PERMISSION_MODE: PermissionMode = 'bypassPermissions';
const PERMISSION_MODE_PROVIDER_PREFIX = 'permissionMode-provider-';
const PERMISSION_MODE_SESSION_PREFIX = 'permissionMode-';
const PERMISSION_MODE_MIGRATION_KEY = 'medhelp-permission-mode-pi-auto-v2';
const PERMISSION_MODE_PROVIDERS: SessionProvider[] = ['pi'];
const RESTRICTED_DEFAULT_MODES = new Set(['default', 'acceptEdits']);

const isSessionProvider = (value: string | null | undefined): value is SessionProvider =>
  value === 'pi';

export const sanitizeProvider = (value: string | null | undefined): SessionProvider | null => (
  isSessionProvider(value) ? value : null
);

const migrateStoredPermissionModeDefaults = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (localStorage.getItem(PERMISSION_MODE_MIGRATION_KEY) === DEFAULT_PERMISSION_MODE) {
      return;
    }

    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => Boolean(key));

    keys.forEach((key) => {
      const isPermissionModeKey =
        key.startsWith(PERMISSION_MODE_PROVIDER_PREFIX)
        || (
          key.startsWith(PERMISSION_MODE_SESSION_PREFIX)
          && !key.startsWith(PERMISSION_MODE_MIGRATION_KEY)
        );

      if (!isPermissionModeKey) {
        return;
      }

      const storedMode = localStorage.getItem(key);
      const isSessionModeKey = key.startsWith(PERMISSION_MODE_SESSION_PREFIX)
        && !key.startsWith(PERMISSION_MODE_PROVIDER_PREFIX)
        && !key.startsWith(PERMISSION_MODE_MIGRATION_KEY);
      if (isSessionModeKey && storedMode === 'readOnly') {
        localStorage.setItem(key, 'auto');
        return;
      }
      if (storedMode && RESTRICTED_DEFAULT_MODES.has(storedMode)) {
        localStorage.setItem(key, DEFAULT_PERMISSION_MODE);
      }
    });

    PERMISSION_MODE_PROVIDERS.forEach((provider) => {
      const key = `${PERMISSION_MODE_PROVIDER_PREFIX}${provider}`;
      const storedMode = localStorage.getItem(key);
      const providerDefault = provider === 'pi' ? 'auto' : DEFAULT_PERMISSION_MODE;
      if (!storedMode || RESTRICTED_DEFAULT_MODES.has(storedMode) || (provider === 'pi' && storedMode === 'readOnly')) {
        localStorage.setItem(key, providerDefault);
      }
    });

    localStorage.setItem(PERMISSION_MODE_MIGRATION_KEY, DEFAULT_PERMISSION_MODE);
  } catch {
    // localStorage can be unavailable in hardened browser contexts; keep runtime defaults.
  }
};

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    migrateStoredPermissionModeDefaults();
    return DEFAULT_PERMISSION_MODE;
  });
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setRawProvider] = useState<SessionProvider>(() => (
    sanitizeProvider(localStorage.getItem('selected-provider')) || 'pi'
  ));
  const setProvider = useCallback((next: SetStateAction<SessionProvider>) => {
    setRawProvider((previous) => {
      const resolved = typeof next === 'function'
        ? (next as (prevState: SessionProvider) => SessionProvider)(previous)
        : next;
      return sanitizeProvider(resolved) || 'pi';
    });
  }, []);
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return normalizeClaudeStoredModelSelection(localStorage.getItem('claude-model'));
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return normalizeCodexStoredModelSelection(localStorage.getItem('codex-model'));
  });
  // Pi's historical session metadata can contain raw SDK model IDs. It is not
  // a next-turn preference; the account status validates our remembered choice.
  const [piModel, setPiModel] = useState<string>(() => (
    localStorage.getItem('pi-model') || ''
  ));
  const [piModelProviderId, setPiModelProviderId] = useState<string>(() => (
    localStorage.getItem('pi-model-provider') || ''
  ));
  const [piModelApi, setPiModelApi] = useState<string>(() => (
    localStorage.getItem('pi-model-api') || ''
  ));
  const [piCatalogRevision, setPiCatalogRevision] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem('pi-catalog-revision'));
    return Number.isInteger(stored) && stored > 0 ? stored : null;
  });

  const lastProviderRef = useRef(provider);

  const getProviderPermissionModes = useCallback((p: SessionProvider): PermissionMode[] => {
    if (p === 'pi') return ['auto', 'ask', 'readOnly', 'plan'];
    return p === 'codex'
      ? ['default', 'acceptEdits', 'bypassPermissions']
      : ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
  }, []);

  const getProviderModeStorageKey = useCallback((p: SessionProvider) => `permissionMode-provider-${p}`, []);

  useEffect(() => {
    const validModes = getProviderPermissionModes(provider);
    const providerMode = localStorage.getItem(getProviderModeStorageKey(provider));
    const providerFallback: PermissionMode = provider === 'pi' ? 'auto' : DEFAULT_PERMISSION_MODE;
    const defaultMode: PermissionMode = validModes.includes((providerMode as PermissionMode))
      ? (providerMode as PermissionMode)
      : providerFallback;

    if (!selectedSession?.id) {
      setPermissionMode(defaultMode);
      return;
    }

    const savedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`);
    if (savedMode && validModes.includes(savedMode as PermissionMode)) {
      setPermissionMode(savedMode as PermissionMode);
    } else {
      setPermissionMode(defaultMode);
    }
  }, [selectedSession?.id, provider, getProviderPermissionModes, getProviderModeStorageKey]);

  useEffect(() => {
    const nextProvider = sanitizeProvider(selectedSession?.__provider);
    if (!nextProvider || nextProvider === provider) {
      return;
    }

    setProvider(nextProvider);
    localStorage.setItem('selected-provider', nextProvider);
  }, [provider, selectedSession, setProvider]);

  useEffect(() => {
    const storedProvider = localStorage.getItem('selected-provider');
    const nextProvider = sanitizeProvider(storedProvider ?? provider) || 'pi';

    if (storedProvider !== nextProvider) {
      localStorage.setItem('selected-provider', nextProvider);
    }

    if (provider !== nextProvider) {
      setProvider(nextProvider);
    }
  }, [provider, setProvider]);

  useEffect(() => {
    const storedClaudeModel = localStorage.getItem('claude-model');
    const normalizedClaudeModel = normalizeClaudeStoredModelSelection(storedClaudeModel);

    if (storedClaudeModel !== normalizedClaudeModel) {
      localStorage.setItem('claude-model', normalizedClaudeModel);
    }
  }, []);

  useEffect(() => {
    const storedCodexModel = localStorage.getItem('codex-model');
    const normalizedCodexModel = normalizeCodexStoredModelSelection(storedCodexModel);

    if (storedCodexModel !== normalizedCodexModel) {
      localStorage.setItem('codex-model', normalizedCodexModel);
    }
  }, []);

  useEffect(() => {
    if (lastProviderRef.current === provider) {
      return;
    }
    setPendingPermissionRequests([]);
    lastProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getProviderPermissionModes(provider);

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setPermissionMode(nextMode);
    localStorage.setItem(getProviderModeStorageKey(provider), nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [permissionMode, provider, selectedSession?.id, getProviderPermissionModes, getProviderModeStorageKey]);

  const selectPermissionMode = useCallback((nextMode: PermissionMode) => {
    const modes = getProviderPermissionModes(provider);
    if (!modes.includes(nextMode)) {
      return;
    }

    setPermissionMode(nextMode);
    localStorage.setItem(getProviderModeStorageKey(provider), nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [provider, selectedSession?.id, getProviderPermissionModes, getProviderModeStorageKey]);

  return {
    provider,
    setProvider,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    piModel,
    setPiModel,
    piModelProviderId,
    setPiModelProviderId,
    piModelApi,
    setPiModelApi,
    piCatalogRevision,
    setPiCatalogRevision,
    permissionMode,
    permissionModes: getProviderPermissionModes(provider),
    setPermissionMode,
    selectPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
