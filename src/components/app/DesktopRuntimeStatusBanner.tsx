import { AlertTriangle, FileText, LoaderCircle, RefreshCw, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useDesktopRuntime } from '../../contexts/DesktopRuntimeContext';
import { Button } from '../ui/button';

const BUSY_STATUSES = new Set<MedHelpDesktopRuntimeStatus['status']>([
  'discovering',
  'starting',
  'stopping',
]);

export function shouldShowDesktopRuntimeBanner(status: MedHelpDesktopRuntimeStatus | null) {
  return Boolean(status && !['running', 'disabled'].includes(status.status));
}

export default function DesktopRuntimeStatusBanner() {
  const { status, supported, restartRuntime, openDiagnostics } = useDesktopRuntime();
  const [restarting, setRestarting] = useState(false);
  const visible = supported && shouldShowDesktopRuntimeBanner(status);
  const busy = Boolean(status && BUSY_STATUSES.has(status.status));
  const restartDeferred = status?.reasonCode === 'restart_deferred';

  useEffect(() => {
    document.body.classList.toggle('medhelp-desktop-runtime-banner-visible', visible);
    return () => document.body.classList.remove('medhelp-desktop-runtime-banner-visible');
  }, [visible]);

  if (!visible || !status) return null;

  const restart = async (force = false) => {
    setRestarting(true);
    try {
      await restartRuntime(force);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <section
      className="medhelp-desktop-runtime-banner fixed right-0 left-0 z-[85] flex h-12 items-center gap-3 border-b border-amber-300/60 bg-amber-50/95 px-4 text-amber-950 shadow-sm backdrop-blur dark:border-amber-900/70 dark:bg-amber-950/95 dark:text-amber-50"
      role="status"
      aria-live="polite"
    >
      {busy || restarting
        ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
        : <AlertTriangle className="h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">
          {busy ? '本地 Runtime 正在恢复' : '本地 Runtime 暂时不可用'}
        </p>
        <p className="truncate text-[11px] opacity-80">{status.message}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || restarting || !status.recoverable}
          onClick={() => void restart(restartDeferred)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {restartDeferred ? '强制重启' : '重启 Runtime'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void openDiagnostics()}>
          <FileText className="h-3.5 w-3.5" />
          日志
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.openSettings?.()}>
          <Settings className="h-3.5 w-3.5" />
          设置
        </Button>
      </div>
    </section>
  );
}
