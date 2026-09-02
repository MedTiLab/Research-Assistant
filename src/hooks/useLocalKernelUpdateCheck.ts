import { useCallback, useEffect, useMemo, useState } from 'react';

import { useOptionalLocalKernel } from '../state/localKernelStore';
import {
  getLocalKernelUpdateProgress,
  startLocalKernelUpdate,
  type LocalKernelUpdateProgress,
} from '../services/localKernelClient';
import type { ReleaseInfo } from '../types/sharedTypes';
import { authenticatedFetch } from '../utils/api';

type LocalKernelReleaseDownloads = {
  installer?: string;
  mac?: string;
  win?: string;
  windows?: string;
  [key: string]: string | undefined;
};

type LocalKernelReleasePayload = {
  ok?: boolean;
  product?: string;
  version?: string;
  downloads?: LocalKernelReleaseDownloads;
  command?: string;
  installCommand?: string;
  installCommands?: {
    default?: string;
    windows?: string;
    [key: string]: string | undefined;
  };
  htmlUrl?: string;
  releaseUrl?: string;
  publishedAt?: string;
  notes?: string;
  body?: string;
  update?: {
    mac?: {
      packageUrl?: string;
      sha256?: string;
      bytes?: number;
    };
    windows?: {
      packageUrl?: string;
      sha256?: string;
      signature?: string;
      signatureAlgorithm?: string;
      bytes?: number;
    };
  };
};

export type LocalKernelUpdateCheck = {
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string | null;
  releaseInfo: ReleaseInfo | null;
  upgradeCommand: string | null;
  downloadUrl: string | null;
  isChecking: boolean;
  canAutoUpdate: boolean;
  startUpdate: (onProgress?: (progress: LocalKernelUpdateProgress) => void) => Promise<void>;
  refresh: () => void;
};

export function parseVersionParts(value: string | null | undefined) {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(String(value || ''));
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

export function isNewerVersion(latestVersion: string | null | undefined, currentVersion: string | null | undefined) {
  const latest = parseVersionParts(latestVersion);
  const current = parseVersionParts(currentVersion);
  if (!latest || !current) {
    return false;
  }

  for (let index = 0; index < latest.length; index += 1) {
    if (latest[index] > current[index]) return true;
    if (latest[index] < current[index]) return false;
  }

  return false;
}

export function resolveKernelDownloadUrl(
  downloads: LocalKernelReleaseDownloads | null | undefined,
  platformValue = typeof navigator === 'undefined' ? '' : navigator.platform,
) {
  const platform = String(platformValue || '').toLowerCase();
  if (!downloads) {
    return null;
  }

  if (platform.includes('mac')) {
    return downloads.mac || downloads.installer || downloads.win || downloads.windows || null;
  }
  if (platform.includes('win')) {
    return downloads.win || downloads.windows || downloads.installer || downloads.mac || null;
  }

  return downloads.installer || downloads.mac || downloads.win || downloads.windows || null;
}

export function resolveKernelInstallCommand(
  payload: Pick<LocalKernelReleasePayload, 'installCommand' | 'installCommands'> | null | undefined,
  platformValue = typeof navigator === 'undefined' ? '' : navigator.platform,
) {
  const platform = String(platformValue || '').toLowerCase();
  const commands = payload?.installCommands || null;
  if (platform.includes('win')) {
    return commands?.windows || payload?.installCommand || commands?.default || null;
  }
  return commands?.default || payload?.installCommand || null;
}

export function resolveKernelReleasePlatform(
  platformValue = typeof navigator === 'undefined' ? '' : navigator.platform,
) {
  const platform = String(platformValue || '').toLowerCase();
  if (platform.includes('mac')) return 'mac';
  if (platform.includes('win')) return 'windows';
  return '';
}

export function normalizeLocalKernelRelease(
  payload: LocalKernelReleasePayload | null | undefined,
  fallbackDownloads?: LocalKernelReleaseDownloads | null,
  platformValue?: string,
) {
  const version = typeof payload?.version === 'string'
    ? payload.version.replace(/^v/, '').trim()
    : null;
  const downloads = payload?.downloads || fallbackDownloads || null;
  const downloadUrl = resolveKernelDownloadUrl(downloads, platformValue);
  // The release protocol keeps its legacy product identifier for backwards
  // compatibility; the customer-facing product name is Local Engine.
  const product = 'MedHelp Local Engine';
  const releaseInfo: ReleaseInfo | null = version
    ? {
        title: `${product} v${version}`,
        body: payload?.body || payload?.notes || '',
        htmlUrl: payload?.htmlUrl || payload?.releaseUrl || downloadUrl || '',
        publishedAt: payload?.publishedAt || '',
      }
    : null;

  return {
    version,
    releaseInfo,
    downloadUrl,
    upgradeCommand: resolveKernelInstallCommand(payload, platformValue),
  };
}

export function useLocalKernelUpdateCheck(): LocalKernelUpdateCheck {
  const localKernel = useOptionalLocalKernel();
  const currentVersion = localKernel?.status?.version || localKernel?.health?.version || null;
  const fallbackDownloads = localKernel?.config?.downloads || null;
  const fallbackInstallCommand = resolveKernelInstallCommand(localKernel?.config || null);
  const isDesktopOnlyDistribution = localKernel?.config?.distribution === 'desktop-only';
  const shouldCheck = !isDesktopOnlyDistribution
    && localKernel?.state === 'connected'
    && Boolean(currentVersion);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [releaseInstallCommand, setReleaseInstallCommand] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const canAutoUpdate = Boolean(
    !isDesktopOnlyDistribution
    && localKernel?.state === 'connected'
    && localKernel.endpoint
    && localKernel.sessionToken
    && localKernel.status?.updateCapability?.supported,
  );

  const startUpdate = useCallback(async (onProgress?: (progress: LocalKernelUpdateProgress) => void) => {
    if (isDesktopOnlyDistribution) {
      throw new Error('Update the Local Engine by updating MedHelp Desktop');
    }
    const endpoint = localKernel?.endpoint;
    const sessionToken = localKernel?.sessionToken;
    if (!endpoint || !sessionToken) {
      throw new Error('Local Engine is not connected');
    }
    if (!localKernel.status?.updateCapability?.supported) {
      throw new Error('This Local Engine version must be upgraded once manually before one-click updates are available');
    }

    const updateStartedAt = Date.now();
    onProgress?.({ state: 'checking', progress: 1 });
    const request = startLocalKernelUpdate(endpoint, sessionToken);
    let result: Awaited<typeof request> | null = null;
    while (!result) {
      const outcome = await Promise.race([
        request.then((value) => ({ done: true as const, value })),
        new Promise<{ done: false }>((resolve) => window.setTimeout(() => resolve({ done: false }), 350)),
      ]);
      if (outcome.done) {
        result = outcome.value;
        break;
      }
      try {
        const snapshot = await getLocalKernelUpdateProgress(endpoint, sessionToken);
        if (snapshot.update) {
          const statusTime = Date.parse(snapshot.update.updatedAt || '');
          if (!Number.isFinite(statusTime) || statusTime >= updateStartedAt - 1000) {
            const elapsed = Date.now() - updateStartedAt;
            const fallbackProgress = snapshot.update.state === 'downloading'
              ? Math.min(70, 5 + Math.floor(elapsed / 1500))
              : snapshot.update.state === 'verifying'
                ? 72
                : snapshot.update.state === 'ready'
                  ? 78
                  : 2;
            onProgress?.({
              ...snapshot.update,
              progress: snapshot.update.progress ?? fallbackProgress,
            });
          }
        }
      } catch {
        // The update request reports its own failure; progress polling is best effort.
      }
    }

    const targetVersion = result.targetVersion || latestVersion;
    onProgress?.({
      state: 'awaiting_manual_restart',
      progress: 100,
      targetVersion: targetVersion || undefined,
    });
  }, [isDesktopOnlyDistribution, latestVersion, localKernel]);

  useEffect(() => {
    let cancelled = false;

    const reset = () => {
      setLatestVersion(null);
      setReleaseInfo(null);
      setDownloadUrl(null);
      setReleaseInstallCommand(null);
      setIsChecking(false);
    };

    if (!shouldCheck) {
      reset();
      return () => {
        cancelled = true;
      };
    }

    const checkKernelRelease = async () => {
      setIsChecking(true);
      try {
        const platform = resolveKernelReleasePlatform();
        const releaseUrl = platform
          ? `/api/local-kernel/public-releases?platform=${encodeURIComponent(platform)}`
          : '/api/local-kernel/public-releases';
        const response = await authenticatedFetch(releaseUrl, {
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => null) as LocalKernelReleasePayload | null;
        if (!response.ok) {
          throw new Error(payload && 'error' in payload ? String(payload.error) : `HTTP ${response.status}`);
        }
        const normalized = normalizeLocalKernelRelease(payload, fallbackDownloads);
        if (cancelled) {
          return;
        }
        setLatestVersion(normalized.version);
        setReleaseInfo(normalized.releaseInfo);
        setDownloadUrl(normalized.downloadUrl);
        setReleaseInstallCommand(normalized.upgradeCommand);
      } catch (error) {
        if (!cancelled) {
          console.error('Local Kernel update check failed:', error);
          setLatestVersion(null);
          setReleaseInfo(null);
          setDownloadUrl(null);
          setReleaseInstallCommand(null);
        }
      } finally {
        if (!cancelled) {
          setIsChecking(false);
        }
      }
    };

    void checkKernelRelease();
    const interval = window.setInterval(checkKernelRelease, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [fallbackDownloads, refreshNonce, shouldCheck]);

  const upgradeCommand = useMemo(() => {
    if (releaseInstallCommand) {
      return releaseInstallCommand;
    }
    if (fallbackInstallCommand) {
      return fallbackInstallCommand;
    }
    if (downloadUrl && downloadUrl.endsWith('/install.sh')) {
      return `curl -fsSL ${downloadUrl} | sh`;
    }
    return null;
  }, [downloadUrl, fallbackInstallCommand, releaseInstallCommand]);

  return {
    updateAvailable: isNewerVersion(latestVersion, currentVersion),
    latestVersion,
    currentVersion,
    releaseInfo,
    upgradeCommand,
    downloadUrl,
    isChecking,
    canAutoUpdate,
    startUpdate,
    refresh,
  };
}
