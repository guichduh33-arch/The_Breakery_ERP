// apps/pos/src/features/lan/hooks/useLanHeartbeat.ts
//
// Session 13 / Phase 5.A — heartbeat cloud vers lan_devices.
// Spec 006x lot 2 — le hub LAN est l'écrivain cloud NOMINAL (il agrège la
// présence du bus et pousse un batch via l'EF lan-heartbeat-batch) : tant que
// useHubConnectionStore.connected est vrai, ce hook se tait. Quand le hub est
// injoignable (mode dégradé, spec §3-A3), fallback direct :
// `update_lan_heartbeat_v2` avec un batch de 1. No-op silencieux si le device
// n'est pas enregistré (l'opérateur BO le crée via LanDevicesPage).

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useHubConnectionStore } from '../hubConnectionStore';

const HEARTBEAT_INTERVAL_MS = 10_000;

interface UseLanHeartbeatOptions {
  /** Device code (== `lan_devices.code`). */
  deviceCode: string;
  /** Device type. */
  deviceType: string;
  /** Disable in tests / E2E. */
  enabled?: boolean;
}

export function useLanHeartbeat({
  deviceCode,
  enabled = true,
}: UseLanHeartbeatOptions): void {
  useEffect(() => {
    if (!enabled) return;
    if (deviceCode === '') return;

    let cancelled = false;

    async function tick(): Promise<void> {
      if (cancelled) return;
      // Hub connecté = le hub porte le heartbeat cloud (un seul écrivain).
      // Lu à CHAQUE tick (pas en dep d'effet) : la bascule hub up/down ne
      // doit pas redémarrer l'intervalle.
      if (useHubConnectionStore.getState().connected) return;
      const { error } = await supabase.rpc('update_lan_heartbeat_v2', {
        p_device_codes: [deviceCode],
      });
      if (error !== null && error !== undefined) {
        // Device not registered yet — silent.
      }
    }

    // Fire immediately, then on interval.
    void tick();
    const handle = window.setInterval(() => { void tick(); }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [deviceCode, enabled]);
}
