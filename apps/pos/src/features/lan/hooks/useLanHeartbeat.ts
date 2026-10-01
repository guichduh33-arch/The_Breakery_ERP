// apps/pos/src/features/lan/hooks/useLanHeartbeat.ts
//
// Session 13 / Phase 5.A — heartbeat cloud vers lan_devices.
// Spec 006x lot 2 — le hub LAN est l'écrivain cloud NOMINAL (il agrège la
// présence du bus et pousse un batch via l'EF lan-heartbeat-batch) : tant que
// useHubConnectionStore.connected est vrai, ce hook se tait. Quand le hub est
// injoignable, l'API d'appareil vérifie le secret individuel en en-tête et
// actualise uniquement la présence de ce terminal autorisé.

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useHubConnectionStore } from '../hubConnectionStore';
import { useLanCredential } from '../lanCredential';
import { isSupabaseCloudEnabled } from '@breakery/supabase';

const HEARTBEAT_INTERVAL_MS = 10_000;

interface UseLanHeartbeatOptions {
  /** Device code (== `lan_devices.code`). */
  deviceCode: string;
  /** Device type. */
  deviceType: string;
  /** Disable in tests / E2E. */
  enabled?: boolean;
}

export function useLanHeartbeat({ deviceCode, enabled = true }: UseLanHeartbeatOptions): void {
  const credential = useLanCredential((s) => s.credential);
  useEffect(() => {
    if (!enabled) return;
    if (!credential) return;
    const identity = credential;

    let cancelled = false;

    async function tick(): Promise<void> {
      if (cancelled) return;
      if (!isSupabaseCloudEnabled()) return;
      // Hub connecté = le hub porte le heartbeat cloud (un seul écrivain).
      // Lu à CHAQUE tick (pas en dep d'effet) : la bascule hub up/down ne
      // doit pas redémarrer l'intervalle.
      if (useHubConnectionStore.getState().connected) return;
      const response: { error: unknown } = await supabase.functions.invoke('lan-device-access', {
        body: { action: 'heartbeat', device_id: identity.id },
        headers: { 'x-lan-secret': identity.secret },
      });
      if (response.error !== null && response.error !== undefined) {
        // Device not registered yet — silent.
      }
    }

    // Fire immediately, then on interval.
    void tick();
    const handle = window.setInterval(() => {
      void tick();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [deviceCode, enabled, credential]);
}
