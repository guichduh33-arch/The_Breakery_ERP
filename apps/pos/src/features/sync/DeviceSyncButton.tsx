import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { syncDeviceData } from './deviceSync';

export function DeviceSyncButton() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const ready = useAuthStore((state) => state.isAuthenticated
    && state.bootstrapStatus === 'ready' && state.cloudValidated && !state.isLocked);
  const cloudOnline = useCloudStatusStore((state) => state.cloudOnline);

  async function sync(): Promise<void> {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const result = await syncDeviceData(client);
      if (result === 'success') toast.success('Data synced.');
      else if (result === 'offline') toast.error('Cannot sync while offline. Cached data is still available.');
      else if (result === 'empty') toast.info('No active data to sync on this screen.');
      else toast.error('Some data could not be synced. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return <Button
    type="button"
    variant="ghost"
    size="icon"
    className="shrink-0"
    disabled={busy || !ready || !cloudOnline}
    aria-label={busy ? 'Syncing data' : 'Sync data'}
    aria-busy={busy}
    title="Sync data"
    onClick={() => { void sync(); }}
    data-testid="device-sync"
  >
    <RefreshCw className={`h-5 w-5 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
  </Button>;
}
