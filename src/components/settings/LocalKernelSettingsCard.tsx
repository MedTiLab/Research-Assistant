import { useState } from 'react';
import { ArrowUpCircle, Cpu, Link2Off, Power, RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useLocalKernelUpdateCheck } from '../../hooks/useLocalKernelUpdateCheck';
import { useOptionalLocalKernel } from '../../state/localKernelStore';
import VersionUpgradeModal from '../modals/VersionUpgradeModal';

export default function LocalKernelSettingsCard() {
  const { t } = useTranslation(['settings', 'common']);
  const localKernel = useOptionalLocalKernel();
  const localKernelUpdate = useLocalKernelUpdateCheck();
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState('');

  if (!localKernel?.isRequired) {
    return null;
  }

  const isConnected = localKernel.state === 'connected';
  const { health, status, disconnect, shutdown } = localKernel;
  const productName = t('common:localKernel.productName');
  const version = status?.version || health?.version || localKernelUpdate.currentVersion || null;
  const permissionMode = status?.permissionMode || 'analysis';
  const updateButtonLabel = localKernelUpdate.updateAvailable
    ? t('common:versionUpdate.localKernel.statusBarUpdate', { version: localKernelUpdate.latestVersion || '' })
    : localKernelUpdate.isChecking
      ? t('common:versionUpdate.localKernel.statusBarChecking')
      : t('common:versionUpdate.localKernel.statusBarCheck');

  const handleKernelUpdateClick = () => {
    if (localKernelUpdate.updateAvailable) {
      setShowUpdateModal(true);
      return;
    }
    localKernelUpdate.refresh();
  };

  const handleShutdown = async () => {
    if (!window.confirm(t('common:localKernel.actions.stopConfirm'))) {
      return;
    }
    setIsStopping(true);
    setStopError('');
    try {
      await shutdown();
    } catch (error) {
      setStopError(error instanceof Error ? error.message : t('common:localKernel.actions.stopFailed'));
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase text-muted-foreground/80">
                {t('userAccount.localKernelSettings.eyebrow')}
              </div>
              <h4 className="mt-1 text-base font-semibold text-foreground">
                {t('userAccount.localKernelSettings.title')}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('userAccount.localKernelSettings.description')}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${
                  isConnected
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                }`}>
                  <Cpu className="h-3.5 w-3.5" />
                  {isConnected ? t('common:localKernel.status.connected') : t('userAccount.localKernelSettings.status.disconnected')}
                </span>
                <span className="inline-flex items-center rounded-full border border-border/70 bg-background px-2.5 py-1 font-medium text-foreground">
                  {productName}
                </span>
                {version && (
                  <span className="inline-flex items-center rounded-full border border-border/70 bg-background px-2.5 py-1 font-mono font-medium text-foreground">
                    v{version}
                  </span>
                )}
                {isConnected && (
                  <span className="inline-flex items-center rounded-full border border-border/70 bg-background px-2.5 py-1 font-medium text-muted-foreground">
                    {permissionMode}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
            <button
              type="button"
              className={
                localKernelUpdate.updateAvailable
                  ? 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/50'
                  : 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60'
              }
              onClick={handleKernelUpdateClick}
              disabled={!isConnected || localKernelUpdate.isChecking}
            >
              {localKernelUpdate.updateAvailable ? (
                <ArrowUpCircle className="h-4 w-4" />
              ) : (
                <RefreshCw className={`h-4 w-4 ${localKernelUpdate.isChecking ? 'animate-spin' : ''}`} />
              )}
              {updateButtonLabel}
            </button>
            {isConnected && (
              <>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                  onClick={disconnect}
                  disabled={isStopping}
                >
                  <Link2Off className="h-4 w-4" />
                  {t('common:localKernel.actions.disconnect')}
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-900/40"
                  onClick={handleShutdown}
                  disabled={isStopping}
                >
                  <Power className="h-4 w-4" />
                  {isStopping
                    ? t('common:localKernel.actions.stopping')
                    : t('common:localKernel.actions.stop')}
                </button>
              </>
            )}
          </div>
        </div>
        {stopError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {stopError}
          </div>
        )}
      </div>

      <VersionUpgradeModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onLater={() => setShowUpdateModal(false)}
        releaseInfo={localKernelUpdate.releaseInfo}
        currentVersion={localKernelUpdate.currentVersion || version || ''}
        latestVersion={localKernelUpdate.latestVersion}
        installMode="npm"
        updateTarget="localKernel"
        upgradeCommand={localKernelUpdate.upgradeCommand}
        downloadUrl={localKernelUpdate.downloadUrl}
        canAutoUpdate={localKernelUpdate.canAutoUpdate}
        onLocalKernelUpdate={localKernelUpdate.startUpdate}
      />
    </>
  );
}
