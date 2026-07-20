// apps/pos/src/features/kds/hooks/useKdsOfflineBus.ts
// Spec 006x lot 3 — branchement du KDS sur le bus LAN.
//
// Monté UNE fois par la page Kds (comme useKdsRealtime — pas dans KdsBoard).
// Écoute en PERMANENCE (pas seulement offline) : une caisse peut être passée
// offline et publier order.fired pendant que le KDS, lui, voit encore le
// cloud — le ticket doit apparaître quand même. Le mode OFFLINE ne change
// que la provenance des MUTATIONS (bump → bus au lieu de RPC).
//
// Au welcome du hub (reconnexion comprise), demande un catchup du ring-buffer
// pour rattraper les enveloppes émises pendant que ce KDS était déconnecté
// (spec §4.2 — hub = relais + journal). Le dedup par msg_id est porté par
// hubBusClient : un catchup qui rejoue du déjà-vu est un no-op.

import { useEffect } from 'react';
import { hubBus } from '@/features/lan/hubBusClient';
import { useHubConnectionStore } from '@/features/lan/hubConnectionStore';
import { parseOrderFired, parseOrderItemStatus } from '@/features/lan/busTopics';
import { useKdsOfflineStore } from '../kdsOfflineStore';

export function useKdsOfflineBus(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const unsubFired = hubBus.subscribe('order.fired', (env) => {
      const payload = parseOrderFired(env.payload);
      if (payload !== null) useKdsOfflineStore.getState().addFired(payload);
    });
    const unsubStatus = hubBus.subscribe('order.item_status', (env) => {
      const payload = parseOrderItemStatus(env.payload);
      if (payload !== null) useKdsOfflineStore.getState().applyStatus(payload);
    });

    // Catchup à chaque bascule disconnected → connected (join initial inclus).
    let wasConnected = useHubConnectionStore.getState().connected;
    if (wasConnected) hubBus.requestCatchup();
    const unsubStore = useHubConnectionStore.subscribe((state) => {
      if (state.connected && !wasConnected) hubBus.requestCatchup();
      wasConnected = state.connected;
    });

    return () => {
      unsubFired();
      unsubStatus();
      unsubStore();
    };
  }, [enabled]);
}
