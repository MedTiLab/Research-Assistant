import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { authenticatedFetch } from "../../utils/api";
import { ReleaseInfo } from "../../types/sharedTypes";
import type { InstallMode } from "../../hooks/useVersionCheck";
import type { LocalKernelUpdateProgress } from "../../services/localKernelClient";

interface VersionUpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onLater: () => void;
    releaseInfo: ReleaseInfo | null;
    currentVersion: string;
    latestVersion: string | null;
    installMode: InstallMode;
    updateTarget?: 'app' | 'localKernel';
    upgradeCommand?: string | null;
    downloadUrl?: string | null;
    canAutoUpdate?: boolean;
    onLocalKernelUpdate?: (onProgress?: (progress: LocalKernelUpdateProgress) => void) => Promise<void>;
    onAppUpdate?: (onProgress?: (progress: LocalKernelUpdateProgress) => void) => Promise<void>;
}

export default function VersionUpgradeModal({
    isOpen,
    onClose,
    onLater,
    releaseInfo,
    currentVersion,
    latestVersion,
    installMode,
    updateTarget = 'app',
    upgradeCommand: providedUpgradeCommand,
    downloadUrl,
    canAutoUpdate = false,
    onLocalKernelUpdate,
    onAppUpdate,
}: VersionUpgradeModalProps) {
    const { t } = useTranslation('common');
    const isLocalKernelUpdate = updateTarget === 'localKernel';
    const defaultUpgradeCommand = installMode === 'npm'
        ? t('versionUpdate.npmUpgradeCommand')
        : 'git checkout main && git pull && npm install';
    const upgradeCommand = isLocalKernelUpdate
        ? providedUpgradeCommand
        : downloadUrl ? null : defaultUpgradeCommand;
    const isManualDesktopDownload = !isLocalKernelUpdate && !canAutoUpdate && Boolean(downloadUrl);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateOutput, setUpdateOutput] = useState('');
    const [updateError, setUpdateError] = useState('');
    const [updateProgress, setUpdateProgress] = useState<LocalKernelUpdateProgress | null>(null);
    const handleDismiss = updateOutput ? onClose : onLater;

    useEffect(() => {
        if (!isOpen) {
            setIsUpdating(false);
            setUpdateOutput('');
            setUpdateError('');
            setUpdateProgress(null);
            return undefined;
        }
        if (!isOpen || typeof document === 'undefined') {
            return undefined;
        }

        const previous = document.body.getAttribute('data-medhelp-version-upgrade-open');
        document.body.setAttribute('data-medhelp-version-upgrade-open', 'true');

        return () => {
            if (previous === null) {
                document.body.removeAttribute('data-medhelp-version-upgrade-open');
            } else {
                document.body.setAttribute('data-medhelp-version-upgrade-open', previous);
            }
        };
    }, [isOpen]);
    
    const handleUpdateNow = useCallback(async () => {
        setIsUpdating(true);
        setUpdateOutput(isLocalKernelUpdate
            ? `${t('versionUpdate.localKernel.autoUpdateStarting')}\n`
            : `${t('versionUpdate.desktop.autoUpdateStarting')}\n`);
        setUpdateError('');
        setUpdateProgress((isLocalKernelUpdate || canAutoUpdate) ? { state: 'checking', progress: 0 } : null);

        try {
            if (isLocalKernelUpdate) {
                if (!onLocalKernelUpdate) {
                    throw new Error(t('versionUpdate.localKernel.autoUpdateUnavailable'));
                }
                await onLocalKernelUpdate((nextProgress) => {
                    setUpdateProgress((previous) => ({
                        ...nextProgress,
                        progress: Math.max(previous?.progress || 0, nextProgress.progress || 0),
                    }));
                });
                setUpdateOutput(prev => prev + `\n✅ ${t('versionUpdate.localKernel.autoUpdateComplete')}\n`);
                return;
            }
            if (canAutoUpdate && onAppUpdate) {
                await onAppUpdate((nextProgress) => {
                    setUpdateProgress((previous) => ({
                        ...nextProgress,
                        progress: Math.max(previous?.progress || 0, nextProgress.progress || 0),
                    }));
                });
                return;
            }
            // Call the backend API to run the update command
            const response = await authenticatedFetch('/api/system/update', {
                method: 'POST',
            });

            const data = await response.json();

            if (response.ok) {
                setUpdateOutput(prev => prev + data.output + '\n');
                setUpdateOutput(prev => prev + '\n✅ Update completed successfully!\n');
                setUpdateOutput(prev => prev + 'Please restart the server to apply changes.\n');
            } else {
                setUpdateError(data.error || 'Update failed');
                setUpdateOutput(prev => prev + '\n❌ Update failed: ' + (data.error || 'Unknown error') + '\n');
            }
        } catch (error: any) {
            if (isLocalKernelUpdate) {
                setUpdateProgress((previous) => ({
                    ...previous,
                    state: 'failed',
                    progress: previous?.progress || 0,
                    error: error.message,
                }));
            }
            setUpdateError(error.message);
            setUpdateOutput(prev => prev + '\n❌ Update failed: ' + error.message + '\n');
        } finally {
            setIsUpdating(false);
        }
    }, [canAutoUpdate, isLocalKernelUpdate, onAppUpdate, onLocalKernelUpdate, t]);

    if (!isOpen) return null;

    const modal = (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center">
            {/* Backdrop */}
            <button
                className="fixed inset-0 bg-black/50 backdrop-blur-sm"
                onClick={isUpdating ? undefined : handleDismiss}
                aria-label={t('versionUpdate.ariaLabels.closeModal')}
            />

            {/* Modal */}
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                {isLocalKernelUpdate ? t('versionUpdate.localKernel.title') : t('versionUpdate.title')}
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {releaseInfo?.title || (
                                    isLocalKernelUpdate
                                        ? t('versionUpdate.localKernel.newVersionReady')
                                        : t('versionUpdate.newVersionReady')
                                )}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={isUpdating ? undefined : handleDismiss}
                        disabled={isUpdating}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Version Info */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {isLocalKernelUpdate ? t('versionUpdate.localKernel.currentVersion') : t('versionUpdate.currentVersion')}
                        </span>
                        <span className="text-sm text-gray-900 dark:text-white font-mono">{currentVersion}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                        <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                            {isLocalKernelUpdate ? t('versionUpdate.localKernel.latestVersion') : t('versionUpdate.latestVersion')}
                        </span>
                        <span className="text-sm text-blue-900 dark:text-blue-100 font-mono">{latestVersion}</span>
                    </div>
                </div>

                {/* Changelog */}
                {releaseInfo?.body && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium text-gray-900 dark:text-white">{t('versionUpdate.whatsNew')}</h3>
                            {releaseInfo?.htmlUrl && (
                                <a
                                    href={releaseInfo.htmlUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex items-center gap-1"
                                >
                                    {t('versionUpdate.viewFullRelease')}
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                </a>
                            )}
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600 max-h-64 overflow-y-auto">
                            <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none">
                                {cleanChangelog(releaseInfo.body)}
                            </div>
                        </div>
                    </div>
                )}

                {/* Update Output */}
                {updateProgress && (isLocalKernelUpdate || canAutoUpdate) && (
                    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/70 dark:bg-blue-950/30">
                        <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-blue-900 dark:text-blue-100">
                                {t(`versionUpdate.${isLocalKernelUpdate ? 'localKernel' : 'desktop'}.progressStates.${updateProgress.state || 'checking'}`)}
                            </span>
                            <span className="font-mono font-semibold tabular-nums text-blue-700 dark:text-blue-200">
                                {Math.max(0, Math.min(100, Math.round(updateProgress.progress || 0)))}%
                            </span>
                        </div>
                        <div
                            className="h-2.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/60"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.max(0, Math.min(100, Math.round(updateProgress.progress || 0)))}
                        >
                            <div
                                className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out dark:bg-blue-400"
                                style={{ width: `${Math.max(0, Math.min(100, updateProgress.progress || 0))}%` }}
                            />
                        </div>
                        {updateProgress.state === 'downloading' && updateProgress.totalBytes && (
                            <div className="text-xs text-blue-700/80 dark:text-blue-200/80">
                                {t(`versionUpdate.${isLocalKernelUpdate ? 'localKernel' : 'desktop'}.downloadBytes`, {
                                    downloaded: ((updateProgress.downloadedBytes || 0) / 1024 / 1024).toFixed(1),
                                    total: (updateProgress.totalBytes / 1024 / 1024).toFixed(1),
                                })}
                            </div>
                        )}
                    </div>
                )}

                {(updateOutput || updateError) && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white">{t('versionUpdate.updateProgress')}</h3>
                        <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 border border-gray-700 max-h-48 overflow-y-auto">
                            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">{updateOutput}</pre>
                        </div>
                        {updateError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                                {updateError}
                            </div>
                        )}
                    </div>
                )}

                {/* Upgrade Instructions */}
                {!isUpdating && !updateOutput && !canAutoUpdate && (
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                            {isLocalKernelUpdate
                                ? t('versionUpdate.localKernel.manualUpgrade')
                                : isManualDesktopDownload
                                    ? t('versionUpdate.desktop.manualUpgrade')
                                    : t('versionUpdate.manualUpgrade')}
                        </h3>
                        {upgradeCommand && (
                            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 border">
                                <code className="text-sm text-gray-800 dark:text-gray-200 font-mono">
                                    {upgradeCommand}
                                </code>
                            </div>
                        )}
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            {isLocalKernelUpdate
                                ? t('versionUpdate.localKernel.manualUpgradeHint')
                                : isManualDesktopDownload
                                    ? t('versionUpdate.desktop.manualUpgradeHint')
                                : t('versionUpdate.manualUpgradeHint')}
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                    <button
                        onClick={isUpdating ? undefined : handleDismiss}
                        disabled={isUpdating}
                        className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                    >
                        {updateOutput ? t('versionUpdate.buttons.close') : t('versionUpdate.buttons.later')}
                    </button>
                    {!updateOutput && (
                        <>
                            {upgradeCommand && (!isLocalKernelUpdate || !canAutoUpdate) && (
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(upgradeCommand);
                                    }}
                                    className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                                >
                                    {t('versionUpdate.buttons.copyCommand')}
                                </button>
                            )}
                            {isLocalKernelUpdate ? (
                                canAutoUpdate ? (
                                    <button
                                        onClick={handleUpdateNow}
                                        disabled={isUpdating}
                                        className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed rounded-md transition-colors flex items-center justify-center gap-2"
                                    >
                                        {isUpdating ? (
                                            <>
                                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                {t('versionUpdate.buttons.updating')}
                                            </>
                                        ) : (
                                            t('versionUpdate.buttons.updateNow')
                                        )}
                                    </button>
                                ) : downloadUrl && !upgradeCommand && (
                                    <a
                                        href={downloadUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors text-center"
                                    >
                                        {t('versionUpdate.buttons.downloadKernel')}
                                    </a>
                                )
                            ) : isManualDesktopDownload ? (
                                <a
                                    href={downloadUrl || undefined}
                                    download
                                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors text-center"
                                >
                                    {t('versionUpdate.buttons.downloadDesktop')}
                                </a>
                            ) : (
                                <button
                                    onClick={handleUpdateNow}
                                    disabled={isUpdating}
                                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed rounded-md transition-colors flex items-center justify-center gap-2"
                                >
                                    {isUpdating ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            {t('versionUpdate.buttons.updating')}
                                        </>
                                    ) : (
                                        t('versionUpdate.buttons.updateNow')
                                    )}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );

    return typeof document !== 'undefined'
        ? createPortal(modal, document.body)
        : modal;
};

// Clean up changelog by removing GitHub-specific metadata
const cleanChangelog = (body: string) => {
    if (!body) return '';

    return body
        // Remove full commit hashes (40 character hex strings)
        .replace(/\b[0-9a-f]{40}\b/gi, '')
        // Remove short commit hashes (7-10 character hex strings at start of line or after dash/space)
        .replace(/(?:^|\s|-)([0-9a-f]{7,10})\b/gi, '')
        // Remove "Full Changelog" links
        .replace(/\*\*Full Changelog\*\*:.*$/gim, '')
        // Remove compare links (e.g., https://github.com/.../compare/v1.0.0...v1.0.1)
        .replace(/https?:\/\/github\.com\/[^\/]+\/[^\/]+\/compare\/[^\s)]+/gi, '')
        // Clean up multiple consecutive empty lines
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        // Trim whitespace
        .trim();
};
