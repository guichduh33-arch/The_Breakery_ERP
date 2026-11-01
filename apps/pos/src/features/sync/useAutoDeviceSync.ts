import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { syncDeviceData } from './deviceSync';

export const DEVICE_SYNC_INTERVAL_MS = 30_000;

/** Filet de lecture quand le push est manqué, uniquement au premier plan. */
export function useAutoDeviceSync(enabled: boolean): void {
  const client = useQueryClient();
  const cloudOnline = useCloudStatusStore((state) => state.cloudOnline);

  useEffect(() => {
    if (!enabled || !cloudOnline) return;
    let lastAttempt = -Infinity;
    const refresh = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastAttempt < 1_000) return;
      lastAttempt = Date.now();
      void syncDeviceData(client);
    };
    // Une reconnexion / reprise de session rattrape aussi les événements perdus.
    refresh();
    const timer = window.setInterval(refresh, DEVICE_SYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [client, enabled, cloudOnline]);
}
