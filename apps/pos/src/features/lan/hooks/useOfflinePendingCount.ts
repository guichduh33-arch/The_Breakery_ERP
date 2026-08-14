// apps/pos/src/features/lan/hooks/useOfflinePendingCount.ts
//
// Compteur d'intents offline en attente de replay, pour l'indicateur ambiant
// du comptoir (principe produit n°3 : la caisse dit son régime, et un
// encaissement en file n'est pas un encaissement abouti). Poll léger : le
// count IDB est une transaction readonly, et l'outbox n'expose aucun événement
// de mutation — le polling est le seul signal fiable inter-onglets.

import { useQuery } from '@tanstack/react-query';
import { pendingIntentCount } from '../offlineOutbox';

export function useOfflinePendingCount(): number {
  const { data } = useQuery({
    queryKey: ['offline', 'pending-intent-count'],
    queryFn: pendingIntentCount,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });
  return data ?? 0;
}
