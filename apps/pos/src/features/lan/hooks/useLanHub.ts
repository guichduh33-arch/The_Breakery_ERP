// apps/pos/src/features/lan/hooks/useLanHub.ts
//
// Session 13 / Phase 5.A — mount the LAN hub on a single POS terminal.
//
// D19 channel-uniqueness pattern (CORRECTED) :
//   - UUID is minted INSIDE `useEffect`, NOT in a component-body `useMemo`.
//   - Each effect mount therefore produces a fresh UUID. StrictMode dev
//     double-mount yields 2 distinct channels — the second mount can't
//     collide with the first's still-subscribed channel.
//   - See `useKdsRealtime.ts` for the canonical reference + D-W4-4C-03 /
//     D-W4-4B-05 deviation entries.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LanHub } from '../lanHub';
import { handleLanMessage } from '../lanHubMessageHandler';
import type { LanMessage } from '@breakery/domain';

interface UseLanHubOptions {
  /** Stable id for this hub instance. Typically the POS terminal device id. */
  hubDeviceId: string;
  /** Set false to disable while the feature is being rolled out. */
  enabled?: boolean;
}

export function useLanHub({ hubDeviceId, enabled = true }: UseLanHubOptions): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    if (hubDeviceId === '') return;

    // D19 — per-effect-mount UUID. NOT a useMemo.
    const channelKeySuffix = crypto.randomUUID();
    const bc = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('breakery-lan')
      : null;

    const hub = new LanHub({
      supabase,
      hubDeviceId,
      channelKeySuffix,
      broadcastChannel: bc,
      onMessage: (msg: LanMessage) =>
        handleLanMessage(msg, {
          supabase,
          queryClient,
          hubDeviceId,
          reply: (m) => hub.send(m),
        }),
    });

    hub.start();

    return () => {
      hub.stop();
      if (bc !== null) bc.close();
    };
  }, [hubDeviceId, enabled, queryClient]);
}
