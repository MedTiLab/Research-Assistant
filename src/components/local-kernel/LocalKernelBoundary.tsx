import { useRef, type ReactNode } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import LocalKernelGate from './LocalKernelGate';
import { useLocalKernel } from '../../state/localKernelStore';
import { getDesktopRuntimeInfo } from '../../utils/desktopRuntime';
import { shouldShowLocalKernelWorkspace } from './localKernelVisibility';
import { shouldShowDesktopKernelTransition } from '../../state/localKernelRecovery';
import { useAuth } from '../../contexts/AuthContext';

function DesktopKernelTransition({
  failed = false,
  onRetry,
  error,
  onSignOut,
}: {
  failed?: boolean;
  onRetry?: () => Promise<void>;
  error?: string | null;
  onSignOut?: () => void;
}) {
  return (
    <div
      data-medhelp-desktop-kernel-transition="true"
      role={failed ? 'alert' : 'status'}
      className="flex min-h-screen items-center justify-center bg-[#eef2f5] px-4 text-slate-700 dark:bg-background dark:text-foreground"
    >
      <div className="text-center">
        <img src="/logo.png" alt="MedHelp" className="mx-auto h-16 w-16 rounded-2xl object-cover shadow-sm" />
        <p className="mt-4 text-sm font-medium">
          {failed ? '暂时无法连接工作区' : '正在进入工作台…'}
        </p>
        {failed ? (
          <>
            <p className="mt-2 text-xs text-slate-500 dark:text-muted-foreground">
              {error || '请检查本地服务和在线账号授权，然后重试。'}
            </p>
            <button
              type="button"
              onClick={() => void onRetry?.()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-700/20 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-700/10 dark:text-emerald-300"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 重试连接
            </button>
            {onSignOut && (
              <button type="button" className="ml-3 text-xs underline" onClick={onSignOut}>
                退出并重新登录
              </button>
            )}
          </>
        ) : (
          <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin text-emerald-600" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

export default function LocalKernelBoundary({ children }: { children: ReactNode }) {
  const { isRequired, state, retry, error } = useLocalKernel();
  const { logout } = useAuth();
  const hasConnectedRef = useRef(false);
  const runtime = getDesktopRuntimeInfo();

  if (state === 'connected') {
    hasConnectedRef.current = true;
  }

  // Electron distributions own their Runtime lifecycle. They must never fall
  // through to the browser-only install/connect gate after SPA navigation drops
  // the launch query or while the bundled Kernel is being re-paired. Runtime
  // recovery stays in the persistent desktop banner without unmounting AppShell.
  if (runtime.isDesktopShell) {
    // Before the first successful connection there is no workspace to preserve.
    // Surface failed authorization instead of leaving project loaders spinning.
    if (isRequired && !hasConnectedRef.current && ['offline', 'error', 'invalid-endpoint'].includes(state)) {
      return <DesktopKernelTransition failed error={error} onRetry={retry} onSignOut={logout} />;
    }
    return <>{children}</>;
  }

  if (shouldShowLocalKernelWorkspace({
    isRequired,
    state,
    hasConnected: hasConnectedRef.current,
  })) {
    return <>{children}</>;
  }

  const isDesktopKernel = runtime.isDesktopKernel;

  if (
    isDesktopKernel
    && shouldShowDesktopKernelTransition(state)
  ) {
    return <DesktopKernelTransition />;
  }

  return <LocalKernelGate />;
}
