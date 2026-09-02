import { useCallback, useEffect } from 'react';
import { isAppModuleVisible } from '../../config/appModules';
import { api } from '../../utils/api';
import type { Companion } from './types';

export const COMPANIONS_CHANGED_EVENT = 'medhelp-companions-changed';

export function notifyCompanionsChanged() {
  window.dispatchEvent(new Event(COMPANIONS_CHANGED_EVENT));
}

export function useDesktopCompanionSync() {
  const sync = useCallback(async () => {
    const bridge = window.medhelpDesktop;
    if (!bridge?.syncCompanionWindows) return;
    try {
      if (!isAppModuleVisible('companions')) {
        await bridge.syncCompanionWindows([]);
        return;
      }
      const response = await api.companions.list();
      if (!response.ok) return;
      const payload = await response.json() as { companions?: Companion[] };
      await bridge.syncCompanionWindows((payload.companions || []).map((companion) => ({
        id: companion.id,
        name: companion.name,
        avatar: companion.avatar,
        enabled: companion.desktopEnabled,
      })));
    } catch (error) {
      console.warn('[companions] Failed to sync desktop windows:', error);
    }
  }, []);

  useEffect(() => {
    void sync();
    window.addEventListener(COMPANIONS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(COMPANIONS_CHANGED_EVENT, sync);
  }, [sync]);
}
