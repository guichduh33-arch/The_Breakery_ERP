// apps/pos/src/features/lan/hooks/useLanClient.ts
//
// Session 13 / Phase 5.A — mount a LAN client peer on a POS / KDS / tablet.
//
// D19 channel-uniqueness pattern — UUID inside `useEffect`, NOT useMemo.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LanClient } from '../lanClient';
import type { LanMessage } from '@breakery/domain';

interface UseLanClientOptions {
  /** Stable device id (persisted across sessions). */
  deviceId: string;
  enabled?: boolean;
  /** Caller-provided message handler. */
  onMessage?: (msg: LanMessage) => void;
}

export function useLanClient({
  deviceId,
  enabled = true,
  onMessage,
}: UseLanClientOptions): { send: (msg: LanMessage) => void } {
  const clientRef = useRef<LanClient | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    if (deviceId === '') return;

    const channelKeySuffix = crypto.randomUUID();
    const bc = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel('breakery-lan')
      : null;

    const client = new LanClient({
      supabase,
      deviceId,
      channelKeySuffix,
      broadcastChannel: bc,
      onMessage: (msg) => {
        // Default-invalidate caches on inbound traffic — caller can do extra
        // work via the explicit `onMessage` callback.
        queryClient.invalidateQueries({ queryKey: ['kds'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        if (onMessage !== undefined) onMessage(msg);
      },
    });

    clientRef.current = client;
    client.start();

    return () => {
      client.stop();
      clientRef.current = null;
      if (bc !== null) bc.close();
    };
  }, [deviceId, enabled, onMessage, queryClient]);

  function send(msg: LanMessage): void {
    clientRef.current?.send(msg);
  }

  return { send };
}
