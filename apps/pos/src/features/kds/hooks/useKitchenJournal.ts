import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { queryClient } from '@/lib/queryClient';
import { readKitchenJournal } from '../offlineKitchenJournal';
import { replayKitchenJournal } from '../offlineKitchenReplay';
import { useKdsOfflineStore } from '../kdsOfflineStore';

export function useKitchenJournal(): void {
  useEffect(() => {
    try {
      const journal = readKitchenJournal();
      for (const fired of Object.values(journal.fired)) useKdsOfflineStore.getState().addFired(fired);
      for (const status of Object.values(journal.statuses)) useKdsOfflineStore.getState().applyStatus(status);
    } catch {
      useKdsOfflineStore.getState().setIssue('Saved kitchen data could not be loaded. Keep this browser data and contact a manager.');
    }
    const run = () => {
      if (!useCloudStatusStore.getState().cloudOnline) return;
      void replayKitchenJournal().then(() => { void queryClient.invalidateQueries({ queryKey: ['kds'] }); });
    };
    run();
    const timer = setInterval(run, 10_000);
    const auth = useAuthStore.subscribe(run);
    const cloud = useCloudStatusStore.subscribe(run);
    return () => { clearInterval(timer); auth(); cloud(); };
  }, []);
}
