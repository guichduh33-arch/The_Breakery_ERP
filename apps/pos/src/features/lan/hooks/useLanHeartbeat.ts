// apps/pos/src/features/lan/hooks/useLanHeartbeat.ts
//
// Session 13 / Phase 5.A — emit a 10-second heartbeat to lan_devices.
//
// On every tick :
//   1. Calls `update_lan_heartbeat_v1(p_device_code)` to touch
//      `lan_devices.last_heartbeat_at` server-side. Silently no-ops if the
//      device is not registered (the BO operator can create it via
//      LanDevicesPage).
//
// The heartbeat is also broadcast over the LAN mesh (Realtime+BroadcastChannel)
// so the elected hub can refresh its in-memory peers map.

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { createMessage, type HeartbeatMessage } from '@breakery/domain';
import type { LanMessage } from '@breakery/domain';

const HEARTBEAT_INTERVAL_MS = 10_000;

interface UseLanHeartbeatOptions {
  /** Device code (== `lan_devices.code`). */
  deviceCode: string;
  /** Device type (drives the HeartbeatMessage payload). */
  deviceType: HeartbeatMessage['payload']['device_type'];
  /** Optional LAN client send fn (from useLanClient). */
  send?: (msg: LanMessage) => void;
  /** Disable in tests / E2E. */
  enabled?: boolean;
}

export function useLanHeartbeat({
  deviceCode,
  deviceType,
  send,
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

      // Broadcast on the LAN mesh.
      if (send !== undefined) {
        const hb = createMessage<HeartbeatMessage>({
          from: deviceCode,
          type: 'heartbeat',
          payload: { device_type: deviceType },
        });
        send(hb);
      }
    }

    // Fire immediately, then on interval.
    void tick();
    const handle = window.setInterval(() => { void tick(); }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [deviceCode, deviceType, send, enabled]);
}
