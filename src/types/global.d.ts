export {};

declare global {
  interface MedHelpDesktopRuntimeStatus {
    status: 'disabled' | 'discovering' | 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped' | 'error' | 'missing';
    reasonCode: string;
    message: string;
    pid: number | null;
    baseUrl: string | null;
    startedAt: string | null;
    lastHealthyAt: string | null;
    restartCount: number;
    recoverable: boolean;
    diagnosticsPath: string | null;
  }

  interface MedHelpDesktopBridge {
    isDesktop: boolean;
    platform: string;
    version?: string;
    uiMode?: 'hosted' | 'offline';
    cloudAppOrigin?: string | null;
    restartApp?: () => Promise<void>;
    getRuntimeStatus?: () => Promise<MedHelpDesktopRuntimeStatus>;
    restartRuntime?: (options?: { force?: boolean }) => Promise<MedHelpDesktopRuntimeStatus>;
    openRuntimeDiagnostics?: () => Promise<boolean>;
    onRuntimeStatus?: (callback: (status: MedHelpDesktopRuntimeStatus) => void) => () => void;
    getUpdateState?: () => Promise<import('../hooks/useDesktopAppUpdate').DesktopAppUpdateState | null>;
    checkForUpdates?: () => Promise<import('../hooks/useDesktopAppUpdate').DesktopAppUpdateState | null>;
    downloadAndInstallUpdate?: () => Promise<import('../hooks/useDesktopAppUpdate').DesktopAppUpdateState | null>;
    onUpdateState?: (
      callback: (state: import('../hooks/useDesktopAppUpdate').DesktopAppUpdateState) => void,
    ) => () => void;
    startCliLogin?: (provider: 'claude') => Promise<{ ok: boolean; error?: string }>;
    restoreAuthSession?: () => Promise<Record<string, unknown> | null>;
    saveAuthSession?: (payload: Record<string, unknown>) => Promise<boolean>;
    clearAuthSession?: () => Promise<boolean>;
    writeClipboardText?: (text: string) => Promise<boolean>;
    playCompletionSound?: () => Promise<boolean>;
    showNotification?: (payload: { title: string; body?: string }) => Promise<boolean>;
    saveFile?: (payload: { defaultFileName: string; data: ArrayBuffer }) => Promise<{ canceled?: boolean; filePath?: string }>;
    syncCompanionWindows?: (companions: Array<{
      id: string;
      name: string;
      avatar: string;
      enabled: boolean;
    }>) => Promise<boolean>;
    choosePetDirectory?: () => Promise<{
      canceled: boolean;
      directory?: string;
      asset?: CodexPetAsset;
    }>;
    loadPetAsset?: (directory: string) => Promise<CodexPetAsset>;
    focusMainWindow?: (tab?: 'companions' | 'miniApps') => Promise<boolean>;
    onOpenAppTab?: (callback: (tab: 'companions' | 'miniApps') => void) => () => void;
  }

  interface CodexPetAsset {
    id: string;
    displayName: string;
    description: string;
    spriteVersionNumber: 2;
    spritesheetDataUrl: string;
    frameCounts: Record<string, number>;
  }

  interface Window {
    __ROUTER_BASENAME__?: string;
    medhelpDesktop?: MedHelpDesktopBridge;
    refreshProjects?: () => void | Promise<void>;
    openSettings?: (tab?: string) => void;
  }
}
