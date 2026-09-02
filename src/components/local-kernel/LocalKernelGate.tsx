import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  LogOut,
  MonitorDown,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import BrandLogo from '../BrandLogo';
import { useAuth } from '../../contexts/AuthContext';
import { useLocalKernel } from '../../state/localKernelStore';
import {
  LOCAL_NETWORK_ACCESS_DENIED_ERROR,
  LOCAL_NETWORK_ACCESS_REQUIRED_ERROR,
} from '../../services/localKernelClient';
import { getDesktopRuntimeInfo } from '../../utils/desktopRuntime';

type DesktopInstaller = {
  name: string;
  url: string;
  platform: 'windows' | 'macos' | 'linux' | 'other';
  architecture: string | null;
  version: string | null;
};

type DownloadCatalog = {
  medhelpDesktop: DesktopInstaller[];
  ccSwitch: DesktopInstaller[];
};

const DESKTOP_INSTALLER_FALLBACKS: DesktopInstaller[] = [
  {
    name: 'MedHelp-Offline-1.1.19-win-x64.exe',
    url: '/api/public-downloads/object/downloads/MedHelp-Offline-1.1.19-win-x64.exe',
    platform: 'windows',
    architecture: 'x64',
    version: '1.1.19',
  },
  {
    name: 'MedHelp-Offline-1.1.19-mac-arm64.dmg',
    url: '/api/public-downloads/object/downloads/MedHelp-Offline-1.1.19-mac-arm64.dmg',
    platform: 'macos',
    architecture: 'arm64',
    version: '1.1.19',
  },
];

function InstallerDownloadCard({
  installer,
  title,
  details,
}: {
  installer: DesktopInstaller;
  title: string;
  details: string;
}) {
  return (
    <a
      href={installer.url}
      download
      className="flex min-h-24 items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
        <Download className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-slate-950 dark:text-foreground">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-muted-foreground">
          {details}
        </span>
      </span>
    </a>
  );
}

function statusTone(state: string) {
  if (state === 'invalid-endpoint') {
    return 'border-destructive/30 bg-destructive/5 text-destructive';
  }
  if (state === 'offline') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200';
  }
  if (state === 'session-pending') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200';
  }
  if (state === 'probing') {
    return 'border-primary/25 bg-primary/5 text-primary';
  }
  return 'border-border bg-muted text-muted-foreground';
}

function looksLikeBrowserLocalNetworkBlock(error: string | null) {
  const normalized = String(error || '').toLowerCase();
  return normalized.includes('failed to fetch')
    || normalized.includes('load failed')
    || normalized.includes('networkerror')
    || normalized.includes('permission')
    || normalized.includes('local network')
    || normalized.includes('loopback');
}

function StatusIcon({ state }: { state: string }) {
  if (state === 'probing') {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  if (state === 'invalid-endpoint') {
    return <AlertTriangle className="h-4 w-4" />;
  }
  if (state === 'offline') {
    return <PlugZap className="h-4 w-4" />;
  }
  return <ShieldCheck className="h-4 w-4" />;
}

function StepNumber({ children }: { children: string }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-700/15 bg-emerald-700/10 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
      {children}
    </div>
  );
}

export default function LocalKernelGate() {
  const { t } = useTranslation('common');
  const { logout } = useAuth();
  const {
    state,
    endpoint,
    health,
    error,
    invalidEndpointReason,
    retry,
  } = useLocalKernel();
  const isDesktopKernel = getDesktopRuntimeInfo().isDesktopKernel;
  const [downloadCatalog, setDownloadCatalog] = useState<DownloadCatalog>({
    medhelpDesktop: DESKTOP_INSTALLER_FALLBACKS,
    ccSwitch: [],
  });

  useEffect(() => {
    if (isDesktopKernel) return undefined;
    const controller = new AbortController();
    fetch('/api/public-downloads', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        setDownloadCatalog({
          medhelpDesktop: Array.isArray(data?.medhelpDesktop) && data.medhelpDesktop.length > 0
            ? data.medhelpDesktop
            : DESKTOP_INSTALLER_FALLBACKS,
          ccSwitch: Array.isArray(data?.ccSwitch) ? data.ccSwitch : [],
        });
      })
      .catch((fetchError) => {
        if (fetchError?.name !== 'AbortError') {
          console.warn('[local-kernel] Unable to refresh desktop download catalog; using fallback links.');
        }
      });
    return () => controller.abort();
  }, [isDesktopKernel]);

  const windowsInstaller = downloadCatalog.medhelpDesktop.find((installer) => installer.platform === 'windows')
    || DESKTOP_INSTALLER_FALLBACKS[0];
  const macInstaller = downloadCatalog.medhelpDesktop.find((installer) => installer.platform === 'macos')
    || DESKTOP_INSTALLER_FALLBACKS[1];
  const macXattrCommand = 'xattr -cr /Applications/MedHelp.app';
  const visibleError = invalidEndpointReason
    ? t(`localKernel.errors.${invalidEndpointReason || 'unknown'}`)
    : state === 'offline' && looksLikeBrowserLocalNetworkBlock(error)
      ? null
      : error;
  const isLocalNetworkPermissionError = error === LOCAL_NETWORK_ACCESS_DENIED_ERROR
    || error === LOCAL_NETWORK_ACCESS_REQUIRED_ERROR;
  const browserRecoveryHint = state === 'offline' && !isDesktopKernel
    ? t(isLocalNetworkPermissionError
      ? 'localKernel.localNetworkPermission.instructions'
      : 'localKernel.browserRecoveryHint')
    : null;
  const desktopRecoveryHint = state === 'offline' && isDesktopKernel
    ? t('localKernel.desktop.recoveryHint')
    : null;

  const statusKey = useMemo(() => {
    if (state === 'probing') return 'probing';
    if (state === 'invalid-endpoint') return 'invalidEndpoint';
    if (state === 'offline') return 'offline';
    if (state === 'session-pending') return 'sessionPending';
    return 'offline';
  }, [state]);

  const statusTitle = isLocalNetworkPermissionError
    ? t('localKernel.localNetworkPermission.title')
    : isDesktopKernel && state === 'offline'
    ? t('localKernel.desktop.states.offline.title')
    : t(`localKernel.states.${statusKey}.title`);
  const statusDescription = isLocalNetworkPermissionError
    ? t('localKernel.localNetworkPermission.description')
    : isDesktopKernel && state === 'offline'
    ? t('localKernel.desktop.states.offline.description')
    : t(`localKernel.states.${statusKey}.description`);
  const appBenefits = [
    t('localKernel.appDownload.benefits.builtIn'),
    t('localKernel.appDownload.benefits.simple'),
    t('localKernel.appDownload.benefits.secure'),
  ];

  return (
    <div className="min-h-screen bg-[#f8faf8] text-slate-950 dark:bg-background dark:text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-5 sm:px-6 sm:py-7">
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BrandLogo className="h-9 w-36 rounded-none object-contain" variant="transparent" />
              <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white dark:bg-white dark:text-slate-950">
                {isDesktopKernel ? t('localKernel.badgeLabel') : t('localKernel.entryBadgeLabel')}
              </span>
            </div>
            <button
              type="button"
              onClick={logout}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              {t('navigation.logout')}
            </button>
          </div>
          <div className="mt-4 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-foreground sm:text-3xl">
              {isDesktopKernel ? t('localKernel.desktop.title') : t('localKernel.gateTitle')}
            </h1>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-muted-foreground sm:text-base">
              {isDesktopKernel ? t('localKernel.desktop.subtitle') : t('localKernel.gateSubtitle')}
            </p>
            <p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-slate-500 dark:text-muted-foreground">
              {t('localKernel.deviceSlotHint')}
            </p>
          </div>
        </div>

        <div className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 ${statusTone(state)}`}>
          <div className="pt-0.5">
            <StatusIcon state={state} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold sm:text-sm">{statusTitle}</div>
            <p className="mt-0.5 text-xs leading-5 sm:text-sm">{statusDescription}</p>
            {visibleError && !isLocalNetworkPermissionError && (
              <p className="mt-1.5 text-xs leading-5 text-destructive sm:text-sm">
                {visibleError}
              </p>
            )}
            {browserRecoveryHint && (
              <p className="mt-1.5 text-xs leading-5 text-amber-800 dark:text-amber-100 sm:text-sm">
                {browserRecoveryHint}
              </p>
            )}
            {desktopRecoveryHint && (
              <p className="mt-1.5 text-xs leading-5 text-amber-800 dark:text-amber-100 sm:text-sm">
                {desktopRecoveryHint}
              </p>
            )}
          </div>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-current/20 px-2.5 text-xs font-medium hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={retry}
            disabled={state === 'probing'}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${state === 'probing' ? 'animate-spin' : ''}`} />
            {t(isLocalNetworkPermissionError
              ? 'localKernel.localNetworkPermission.retry'
              : 'localKernel.actions.retry')}
          </button>
        </div>

        {isDesktopKernel ? (
          <section className="mx-auto w-full max-w-2xl rounded-2xl border border-emerald-950/10 bg-white p-5 shadow-sm dark:border-border dark:bg-card sm:p-6">
            <div className="flex gap-3">
              <StepNumber>1</StepNumber>
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold text-slate-950 dark:text-foreground">
                  {t('localKernel.desktop.title')}
                </h1>
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-muted-foreground sm:text-sm">
                  {state === 'offline'
                    ? t('localKernel.desktop.offlineDescription')
                    : t('localKernel.desktop.description')}
                </p>
                <div className="mt-3 rounded-xl bg-emerald-700/10 px-3 py-2 text-xs leading-5 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100 sm:text-sm">
                  <div>{t('localKernel.desktop.endpoint')}: {endpoint?.httpBaseUrl || t('localKernel.diagnostics.notDetected')}</div>
                  <div>{t('localKernel.diagnostics.kernel')}: {health ? t('localKernel.productName') : t('localKernel.diagnostics.notDetected')}{health?.version ? ` ${health.version}` : ''}</div>
                </div>
                <button
                  type="button"
                  className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-700/20 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-700/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-100"
                  onClick={retry}
                  disabled={state === 'probing'}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${state === 'probing' ? 'animate-spin' : ''}`} />
                  {t('localKernel.desktop.retry')}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <div className="w-full">
            <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-lg shadow-emerald-950/[0.06] dark:border-emerald-500/30 dark:bg-card">
              <div className="border-b border-emerald-100 bg-emerald-50/70 p-5 dark:border-emerald-500/20 dark:bg-emerald-500/10 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="rounded-xl bg-emerald-600 p-3 text-white shadow-sm shadow-emerald-600/20">
                    <MonitorDown className="h-7 w-7" />
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-card dark:ring-emerald-500/25">
                    {t('localKernel.appDownload.badge')}
                  </span>
                </div>
                <h2 className="mt-4 text-xl font-bold text-slate-950 dark:text-foreground sm:text-2xl">
                  {t('localKernel.appDownload.title')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-muted-foreground">
                  {t('localKernel.appDownload.description')}
                </p>
              </div>
              <div className="p-5 sm:p-6">
                <ul className="space-y-3">
                  {appBenefits.map((benefit) => (
                    <li key={benefit} className="flex items-start gap-2.5 text-sm leading-5 text-slate-600 dark:text-muted-foreground">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <InstallerDownloadCard
                    installer={windowsInstaller}
                    title={t('localKernel.appDownload.windowsAction')}
                    details={`${t('localKernel.appDownload.windowsNote')}${windowsInstaller.version ? ` · v${windowsInstaller.version}` : ''}`}
                  />
                  <InstallerDownloadCard
                    installer={macInstaller}
                    title={t('localKernel.appDownload.macAction')}
                    details={`${t('localKernel.appDownload.macNote')}${macInstaller.version ? ` · v${macInstaller.version}` : ''}`}
                  />
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-border dark:bg-muted/40">
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-foreground">
                      {t('localKernel.appDownload.windowsInstallTitle')}
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-muted-foreground sm:text-sm sm:leading-6">
                      {t('localKernel.appDownload.windowsInstallBody')}
                    </p>
                  </section>
                  <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-border dark:bg-muted/40">
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-foreground">
                      {t('localKernel.appDownload.macInstallTitle')}
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-muted-foreground sm:text-sm sm:leading-6">
                      {t('localKernel.appDownload.macInstallBody')}
                    </p>
                    <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-muted-foreground sm:text-sm">
                      {t('localKernel.appDownload.macDamagedHint')}
                    </p>
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-border dark:bg-background">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-slate-700 dark:text-foreground">
                        {macXattrCommand}
                      </code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(macXattrCommand)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-border dark:text-muted-foreground dark:hover:bg-muted"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t('localKernel.appDownload.copyCommand')}
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            </section>

            {downloadCatalog.ccSwitch.length > 0 && (
              <section className="mt-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm dark:border-emerald-500/30 dark:bg-card sm:p-6">
                <div>
                  <h2 className="text-base font-semibold text-slate-950 dark:text-foreground sm:text-lg">
                    {t('localKernel.appDownload.ccTitle')}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-muted-foreground sm:text-sm">
                    {t('localKernel.appDownload.ccDescription')}
                  </p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {downloadCatalog.ccSwitch.map((installer) => (
                    <InstallerDownloadCard
                      key={installer.url}
                      installer={installer}
                      title={installer.name}
                      details={[
                        installer.platform === 'macos' ? 'macOS' : installer.platform === 'windows' ? 'Windows' : 'Desktop',
                        installer.architecture,
                        installer.version ? `v${installer.version}` : null,
                      ].filter(Boolean).join(' · ')}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        <footer className="mt-5 flex flex-col items-center justify-center gap-1.5 text-center text-xs text-emerald-800 dark:text-emerald-100 sm:flex-row">
          <span>{t('localKernel.diagnostics.kernel')}: {health ? t('localKernel.productName') : t('localKernel.diagnostics.notDetected')}{health?.version ? ` ${health.version}` : ''}</span>
          <span className="hidden text-emerald-800/30 dark:text-emerald-100/30 sm:inline">•</span>
          <span>{t('localKernel.diagnostics.securityHint')}</span>
        </footer>
      </div>
    </div>
  );
}
