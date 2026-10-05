// apps/pos/src/features/lan/hooks/useOfflineReplay.ts
//
// Spec 006x lot 4 — déclencheurs du replay de l'outbox offline :
//   * montage (app relancée après une coupure, outbox non vide) ;
//   * transition cloud offline→online (fin de coupure) ;
//   * login (le replay exige les credentials NORMAUX du terminal — spec §6 :
//     un terminal non authentifié ne peut rien écrire en cloud).
// Monté sur les surfaces qui PRODUISENT des intents : POS et tablette.

import { useEffect } from 'react';
import { toast } from 'sonner';
// Singleton app-wide (lib/queryClient) plutôt que useQueryClient : le hook est
// monté sur des layouts que des tests rendent sans QueryClientProvider, et
// l'invalidation post-replay cible le cache GLOBAL de toute façon.
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/stores/authStore';
import { useCloudStatusStore } from '../cloudStatusStore';
import { replayOfflineOutbox } from '../offlineReplay';

export function useOfflineReplay(): void {
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let rerunRequested = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = 15_000;
    const allowed = (): boolean => {
      const auth = useAuthStore.getState();
      return !cancelled && useCloudStatusStore.getState().cloudOnline
        && auth.isAuthenticated && auth.cloudValidated && !auth.isLocked;
    };
    const clearTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const retry = (): void => {
      if (!allowed() || timer !== null) return;
      timer = setTimeout(() => { timer = null; run(); }, delay);
      delay = Math.min(delay * 2, 60_000);
    };

    const run = (): void => {
      if (!allowed()) return;
      if (running) { rerunRequested = true; return; }
      clearTimer();
      running = true;
      void replayOfflineOutbox().then((res) => {
        if (cancelled) return;
        if (res.replayed > 0) {
          toast.success(
            res.replayed === 1
              ? '1 offline operation resynced'
              : `${res.replayed} offline operations resynced`,
          );
          void queryClient.invalidateQueries({ queryKey: ['orders'] });
          void queryClient.invalidateQueries({ queryKey: ['tablet-orders'] });
          void queryClient.invalidateQueries({ queryKey: ['pending-tablet-orders'] });
          void queryClient.invalidateQueries({ queryKey: ['table_orders'] });
          void queryClient.invalidateQueries({ queryKey: ['products'] });
          void queryClient.invalidateQueries({ queryKey: ['kds'] });
        }
        if (res.failed > 0) {
          toast.error(
            `Offline resync interrupted (${res.failed} still queued) — will retry automatically`,
          );
          retry();
        } else {
          delay = 15_000;
        }
      }).catch(() => {
        if (cancelled) return;
        toast.error('Offline resync interrupted — queued operations will retry automatically');
        retry();
      }).finally(() => {
        running = false;
        if (rerunRequested) {
          rerunRequested = false;
          run();
        }
      });
    };

    let wasAllowed = allowed();
    const changed = (): void => {
      const nowAllowed = allowed();
      if (!nowAllowed) clearTimer();
      else if (!wasAllowed) { delay = 15_000; run(); }
      wasAllowed = nowAllowed;
    };
    const unsubCloud = useCloudStatusStore.subscribe(changed);
    const unsubAuth = useAuthStore.subscribe(changed);
    run();

    return () => {
      cancelled = true;
      clearTimer();
      unsubCloud();
      unsubAuth();
    };
  }, []);
}
