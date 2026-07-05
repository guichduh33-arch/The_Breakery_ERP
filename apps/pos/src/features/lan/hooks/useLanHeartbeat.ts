// apps/pos/src/features/lan/hooks/useLanHeartbeat.ts
//
// Session 13 / Phase 5.A — emit a 10-second heartbeat to lan_devices.
//
// On every tick, calls `update_lan_heartbeat_v1(p_device_code)` to touch
// `lan_devices.last_heartbeat_at` server-side. Silently no-ops if the
// device is not registered (the BO operator can create it via
// LanDevicesPage).

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

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
      // Touch DB row.
      const { error } = await supabase.rpc('update_lan_heartbeat_v1' as never, {
        p_device_code: deviceCode,
      } as never);
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
