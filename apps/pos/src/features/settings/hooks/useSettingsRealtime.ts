// apps/pos/src/features/settings/hooks/useSettingsRealtime.ts
//
// Settings §6.C — propagation Realtime des settings (ADR-006 décision 4).
// Un changement de réglage fait en BO se propage en push < 2 s aux surfaces
// POS (caisse, KDS, customer display, tablette) au lieu d'attendre le
// staleTime des hooks consommateurs (5 min pour la plupart).
//
// Subscribes postgres_changes on the two settings tables published by
// migration 20260717000181 (`business_config` UPDATE, `receipt_templates` *)
// and invalidates the matching TanStack queries — the server stays the single
// source of truth (we trigger a re-read, we never trust the event payload).
// The existing staleTime/refetchInterval fallbacks in the consumer hooks are
// the ADR-mandated safety net when the channel is down; none of them change.
//
// On every SUBSCRIBED transition (initial join AND rejoin after a drop) all
// settings keys are invalidated, so events missed while disconnected are
// caught up on reconnect.
//
// D19 — channel-name uniqueness per effect mount (UUID generated INSIDE the
// effect, never in a component-body useMemo): under StrictMode the second
// mount's `.on()` would otherwise attach to the still-subscribed channel of
// the first mount (`removeChannel` is async). See useKdsRealtime.ts.
//
// `enabled` gates the subscription on auth readiness: postgres_changes joins
// carry the CURRENT realtime token (realtime.setAuth, cf. packages/supabase
// client P0-2) and the RLS SELECT policies filter events — an anon join
// receives nothing. Callers re-arm by flipping `enabled` (PIN login/logout,
// kiosk JWT acquired), which re-subscribes with the fresh token.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

// Prefixes of every POS query that reads business_config. ['business-config']
// covers useTaxConfig, useOrgDisplaySettings, useBusinessIdentity and
// useEnabledPaymentMethods; the two others predate the shared prefix.
const BUSINESS_CONFIG_KEYS: readonly (readonly string[])[] = [
  ['business-config'],
  ['kds_config'],
  ['pos-presets'],
];

// useReceiptTemplate — ['receipt-template', 'default'] matches the prefix.
const RECEIPT_TEMPLATE_KEYS: readonly (readonly string[])[] = [['receipt-template']];

const ALL_SETTINGS_KEYS: readonly (readonly string[])[] = [
  ...BUSINESS_CONFIG_KEYS,
  ...RECEIPT_TEMPLATE_KEYS,
];

function invalidateAll(
  qc: ReturnType<typeof useQueryClient>,
  keys: readonly (readonly string[])[],
): void {
  for (const key of keys) {
    void qc.invalidateQueries({ queryKey: [...key] });
  }
}

/**
 * Push propagation of settings changes to this device. Mount once per
 * authenticated surface (App shell for PIN sessions, display page for the
 * kiosk JWT). Renders nothing, returns nothing — consumers keep reading
 * through their existing hooks.
 */
export function useSettingsRealtime(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;

    const channelName = `settings-realtime-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        // Same strict-literal typing workaround as useKdsRealtime.
        'postgres_changes' as never,
        { event: 'UPDATE', schema: 'public', table: 'business_config' } as never,
        () => invalidateAll(qc, BUSINESS_CONFIG_KEYS),
      )
      .on(
        'postgres_changes' as never,
        // Templates can be created / switched / deleted, not only updated.
        { event: '*', schema: 'public', table: 'receipt_templates' } as never,
        () => invalidateAll(qc, RECEIPT_TEMPLATE_KEYS),
      )
      .subscribe((status: string) => {
        // Initial join and every rejoin after CHANNEL_ERROR/TIMED_OUT: refresh
        // everything so changes missed while offline are picked up.
        if (status === 'SUBSCRIBED') invalidateAll(qc, ALL_SETTINGS_KEYS);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
