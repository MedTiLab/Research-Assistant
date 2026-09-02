import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type DesktopRuntimeContextValue = {
  supported: boolean;
  status: MedHelpDesktopRuntimeStatus | null;
  restartRuntime: (force?: boolean) => Promise<MedHelpDesktopRuntimeStatus | null>;
  openDiagnostics: () => Promise<boolean>;
};

const DesktopRuntimeContext = createContext<DesktopRuntimeContextValue>({
  supported: false,
  status: null,
  restartRuntime: async () => null,
  openDiagnostics: async () => false,
});

export function DesktopRuntimeProvider({ children }: { children: ReactNode }) {
  const bridge = typeof window === 'undefined' ? null : window.medhelpDesktop;
  const supported = Boolean(bridge?.getRuntimeStatus && bridge?.onRuntimeStatus);
  const [status, setStatus] = useState<MedHelpDesktopRuntimeStatus | null>(null);

  useEffect(() => {
    if (!supported || !bridge) return;
    let active = true;
    const unsubscribe = bridge.onRuntimeStatus?.((nextStatus) => {
      if (active) setStatus(nextStatus);
    });
    void bridge.getRuntimeStatus?.().then((nextStatus) => {
      if (active) setStatus(nextStatus);
    }).catch((error) => {
      if (!active) return;
      setStatus({
        status: 'error',
        reasonCode: 'status_ipc_failed',
        message: error instanceof Error ? error.message : String(error),
        pid: null,
        baseUrl: null,
        startedAt: null,
        lastHealthyAt: null,
        restartCount: 0,
        recoverable: true,
        diagnosticsPath: null,
      });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [bridge, supported]);

  const restartRuntime = useCallback(async (force = false) => {
    if (!bridge?.restartRuntime) return null;
    const nextStatus = await bridge.restartRuntime({ force });
    setStatus(nextStatus);
    return nextStatus;
  }, [bridge]);

  const openDiagnostics = useCallback(async () => {
    return bridge?.openRuntimeDiagnostics?.() || false;
  }, [bridge]);

  const value = useMemo(() => ({
    supported,
    status,
    restartRuntime,
    openDiagnostics,
  }), [openDiagnostics, restartRuntime, status, supported]);

  return (
    <DesktopRuntimeContext.Provider value={value}>
      {children}
    </DesktopRuntimeContext.Provider>
  );
}

export function useDesktopRuntime() {
  return useContext(DesktopRuntimeContext);
}
