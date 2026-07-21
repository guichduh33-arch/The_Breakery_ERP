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

    const run = (): void => {
      void replayOfflineOutbox().then((res) => {
        if (cancelled) return;
        if (res.replayed > 0) {
          toast.success(
            res.replayed === 1
              ? '1 opération hors-ligne resynchronisée'
              : `${res.replayed} opérations hors-ligne resynchronisées`,
          );
          void queryClient.invalidateQueries({ queryKey: ['orders'] });
          void queryClient.invalidateQueries({ queryKey: ['products'] });
          void queryClient.invalidateQueries({ queryKey: ['kds'] });
        }
        if (res.failed > 0) {
          toast.error(
            `Resynchronisation hors-ligne interrompue (${res.failed} en attente) — nouvel essai au prochain retour réseau`,
          );
        }
      });
    };

    if (useCloudStatusStore.getState().cloudOnline) run();

    const unsubCloud = useCloudStatusStore.subscribe((s, prev) => {
      if (s.cloudOnline && !prev.cloudOnline) run();
    });
    const unsubAuth = useAuthStore.subscribe((s, prev) => {
      if (s.isAuthenticated && !prev.isAuthenticated) run();
    });

    return () => {
      cancelled = true;
      unsubCloud();
      unsubAuth();
    };
  }, []);
}
