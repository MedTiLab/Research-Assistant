import { useCallback, useEffect, useRef, useState } from 'react';

import type { LocalKernelUpdateProgress } from '../services/localKernelClient';
import type { ReleaseInfo } from '../types/sharedTypes';
import { getDesktopRuntimeInfo } from '../utils/desktopRuntime';
import { isNewerVersion } from './useLocalKernelUpdateCheck';

export type DesktopAppUpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'error';

export type DesktopAppUpdateState = {
  status: DesktopAppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  releaseInfo: ReleaseInfo | null;
};

export type DesktopDownloadArtifact = {
  name?: string;
  url?: string;
  platform?: string;
  architecture?: string | null;
  version?: string | null;
};

type DesktopDownloadCatalog = {
  generatedAt?: string;
  medhelpDesktop?: DesktopDownloadArtifact[];
};

type LegacyDesktopRelease = {
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseInfo: ReleaseInfo | null;
};

const EMPTY_STATE: DesktopAppUpdateState = {
  status: 'unsupported',
  currentVersion: '',
  latestVersion: null,
  progress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  error: null,
  releaseInfo: null,
};

const EMPTY_LEGACY_RELEASE: LegacyDesktopRelease = {
  latestVersion: null,
  downloadUrl: null,
  releaseInfo: null,
};

function normalizeDesktopPlatform(value: string | null | undefined) {
  const platform = String(value || '').toLowerCase();
  if (platform === 'darwin' || platform.includes('mac')) return 'macos';
  if (platform === 'win32' || platform.includes('win')) return 'windows';
  if (platform.includes('linux')) return 'linux';
  return platform;
}

export function selectDesktopDownloadArtifact(
  catalog: DesktopDownloadCatalog | null | undefined,
  platformValue: string | null | undefined,
) {
  const platform = normalizeDesktopPlatform(platformValue);
  const matching = (catalog?.medhelpDesktop || []).filter((artifact) => (
    normalizeDesktopPlatform(artifact.platform) === platform
    && typeof artifact.version === 'string'
    && typeof artifact.url === 'string'
  ));

  return matching.sort((left, right) => {
    const leftPreferred = left.architecture === 'arm64' || left.architecture === 'x64' ? 1 : 0;
    const rightPreferred = right.architecture === 'arm64' || right.architecture === 'x64' ? 1 : 0;
    if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    return String(right.version).localeCompare(String(left.version), undefined, { numeric: true });
  })[0] || null;
}

function readLegacyDesktopVersion(bridge: MedHelpDesktopBridge | undefined) {
  if (bridge?.version) return bridge.version;
  if (typeof window === 'undefined') return '';
  const search = new URLSearchParams(window.location.search || '');
  return search.get('desktopKernelVersion') || '';
}

function asProgress(state: DesktopAppUpdateState): LocalKernelUpdateProgress {
  const progressState = state.status === 'error'
    ? 'failed'
    : state.status === 'available'
      ? 'ready'
      : state.status === 'idle' || state.status === 'unsupported'
        ? 'checking'
        : state.status;
  return {
    state: progressState,
    progress: state.progress,
    downloadedBytes: state.downloadedBytes,
    totalBytes: state.totalBytes,
    currentVersion: state.currentVersion,
    targetVersion: state.latestVersion || undefined,
    error: state.error || undefined,
  };
}

export function useDesktopAppUpdate() {
  const bridge = typeof window === 'undefined' ? undefined : window.medhelpDesktop;
  const desktopRuntime = getDesktopRuntimeInfo();
  const isDesktopShell = desktopRuntime.isDesktopShell;
  const desktopPlatform = bridge?.platform || desktopRuntime.platform;
  const supported = Boolean(
    isDesktopShell
    && bridge?.getUpdateState
    && bridge?.checkForUpdates
    && bridge?.downloadAndInstallUpdate
    && bridge?.onUpdateState,
  );
  const isLegacyDesktop = isDesktopShell && !supported;
  const initialDesktopVersion = readLegacyDesktopVersion(bridge);
  const [state, setState] = useState<DesktopAppUpdateState>({
    ...EMPTY_STATE,
    currentVersion: initialDesktopVersion,
  });
  const [legacyRelease, setLegacyRelease] = useState<LegacyDesktopRelease>(EMPTY_LEGACY_RELEASE);
  const [legacyChecking, setLegacyChecking] = useState(false);
  const progressCallback = useRef<((progress: LocalKernelUpdateProgress) => void) | null>(null);

  const checkLegacyRelease = useCallback(async () => {
    if (!isLegacyDesktop) return null;
    setLegacyChecking(true);
    try {
      const response = await fetch('/api/public-downloads', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const catalog = await response.json() as DesktopDownloadCatalog;
      const artifact = selectDesktopDownloadArtifact(catalog, desktopPlatform);
      const latestVersion = artifact?.version?.replace(/^v/, '').trim() || null;
      const downloadUrl = artifact?.url || null;
      const nextRelease: LegacyDesktopRelease = {
        latestVersion,
        downloadUrl,
        releaseInfo: latestVersion && downloadUrl
          ? {
              title: `MedHelp Desktop v${latestVersion}`,
              body: '',
              htmlUrl: '',
              publishedAt: catalog.generatedAt || '',
            }
          : null,
      };
      setLegacyRelease(nextRelease);
      return nextRelease;
    } catch (error) {
      console.error('Legacy desktop update check failed:', error);
      setLegacyRelease(EMPTY_LEGACY_RELEASE);
      return null;
    } finally {
      setLegacyChecking(false);
    }
  }, [desktopPlatform, isLegacyDesktop]);

  useEffect(() => {
    if (!isLegacyDesktop) {
      setLegacyRelease(EMPTY_LEGACY_RELEASE);
      setLegacyChecking(false);
      return undefined;
    }

    void checkLegacyRelease();
    const interval = window.setInterval(checkLegacyRelease, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [checkLegacyRelease, isLegacyDesktop]);

  useEffect(() => {
    if (!supported || !bridge?.getUpdateState || !bridge.onUpdateState) return undefined;
    let cancelled = false;
    const acceptState = (nextState: DesktopAppUpdateState | null) => {
      if (cancelled || !nextState) return;
      setState(nextState);
      progressCallback.current?.(asProgress(nextState));
    };
    const unsubscribe = bridge.onUpdateState(acceptState);
    void bridge.getUpdateState().then(acceptState).catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge, supported]);

  const refresh = useCallback(async () => {
    if (bridge?.checkForUpdates) return bridge.checkForUpdates();
    return checkLegacyRelease();
  }, [bridge, checkLegacyRelease]);

  const startUpdate = useCallback(async (
    onProgress?: (progress: LocalKernelUpdateProgress) => void,
  ) => {
    if (!bridge?.downloadAndInstallUpdate) {
      throw new Error('当前桌面版本不支持一键更新');
    }
    progressCallback.current = onProgress || null;
    onProgress?.(asProgress({ ...state, status: 'downloading', progress: 0 }));
    try {
      await bridge.downloadAndInstallUpdate();
    } finally {
      progressCallback.current = null;
    }
  }, [bridge, state]);

  const currentVersion = state.currentVersion || initialDesktopVersion;
  const latestVersion = supported ? state.latestVersion : legacyRelease.latestVersion;
  const releaseInfo = supported ? state.releaseInfo : legacyRelease.releaseInfo;

  return {
    ...state,
    currentVersion,
    latestVersion,
    releaseInfo,
    supported,
    isDesktopShell,
    isLegacyDesktop,
    manualDownloadUrl: isLegacyDesktop ? legacyRelease.downloadUrl : null,
    updateAvailable: isDesktopShell && isNewerVersion(latestVersion, currentVersion),
    isChecking: supported ? state.status === 'checking' : legacyChecking,
    startUpdate,
    refresh,
  };
}
