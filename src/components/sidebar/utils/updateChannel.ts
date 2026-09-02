export type SidebarUpdateChannel = 'desktop' | 'localKernel' | null;

type SidebarUpdateChannelInput = {
  isDesktopShell: boolean;
  desktopUpdateAvailable: boolean;
  localKernelUpdateAvailable: boolean;
};

export function resolveSidebarUpdateChannel({
  isDesktopShell,
  desktopUpdateAvailable,
  localKernelUpdateAvailable,
}: SidebarUpdateChannelInput): SidebarUpdateChannel {
  if (isDesktopShell) {
    return desktopUpdateAvailable ? 'desktop' : null;
  }
  return localKernelUpdateAvailable ? 'localKernel' : null;
}
