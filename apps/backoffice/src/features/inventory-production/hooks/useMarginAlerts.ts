// apps/backoffice/src/features/inventory-production/hooks/useMarginAlerts.ts
//
// Session 15 / Phase 5.A — Hooks for the Margin Watch page.
//
// Exposes :
//   - useMarginAlerts(filter)            — Query: list alerts with optional
//                                          status filter ('open' | 'acked' | 'all').
//                                          Ordered by delta_pct ASC (worst first).
//   - useAcknowledgeMarginAlert()         — Mutation: set acknowledged_at = now(),
//                                          acknowledged_by = current user's
//                                          user_profiles.id, optional notes.
//
// Permission gates :
//   - Listing requires reports.inventory.read (RLS already enforces it).
//   - Acknowledging requires inventory.production.create (RLS + column-level
//     trigger margin_alerts_ack_only_guard).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';

export type MarginAlertFilter = 'open' | 'acked' | 'all';

export interface MarginAlertRow {
  id:                  string;
  productId:           string;
  productName:         string | null;
  expectedMarginPct:   number;
  targetMarginPct:     number;
  deltaPct:            number;
  costPerUnit:         number;
  sellingPrice:        number;
  computedAt:          string;
  acknowledgedAt:      string | null;
  acknowledgedBy:      string | null;
  notes:               string | null;
}

interface RawAlertRow {
  id:                  string;
  product_id:          string;
  expected_margin_pct: number | string;
  target_margin_pct:   number | string;
  delta_pct:           number | string;
  cost_per_unit:       number | string;
  selling_price:       number | string;
  computed_at:         string;
  acknowledged_at:     string | null;
  acknowledged_by:     string | null;
  notes:               string | null;
}

function mapRow(r: RawAlertRow, nameMap: Map<string, string>): MarginAlertRow {
  return {
    id:                r.id,
    productId:         r.product_id,
    productName:       nameMap.get(r.product_id) ?? null,
    expectedMarginPct: Number(r.expected_margin_pct),
    targetMarginPct:   Number(r.target_margin_pct),
    deltaPct:          Number(r.delta_pct),
    costPerUnit:       Number(r.cost_per_unit),
    sellingPrice:      Number(r.selling_price),
    computedAt:        r.computed_at,
    acknowledgedAt:    r.acknowledged_at,
    acknowledgedBy:    r.acknowledged_by,
    notes:             r.notes,
  };
}

const SELECT_COLS =
  'id, product_id, expected_margin_pct, target_margin_pct, delta_pct, ' +
  'cost_per_unit, selling_price, computed_at, acknowledged_at, acknowledged_by, notes';

export function useMarginAlerts(filter: MarginAlertFilter) {
  return useQuery<MarginAlertRow[]>({
    queryKey: ['margin-alerts', filter] as const,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from('margin_alerts')
        .select(SELECT_COLS)
        .order('delta_pct', { ascending: true });
      if (filter === 'open') {
        q = q.is('acknowledged_at', null);
      } else if (filter === 'acked') {
        q = q.not('acknowledged_at', 'is', null);
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as RawAlertRow[];

      // Resolve product names in a follow-up lookup.
      const productIds = Array.from(new Set(rows.map((r) => r.product_id)));
      const nameMap = new Map<string, string>();
      if (productIds.length > 0) {
        const { data: prodData, error: prodErr } = await supabase
          .from('products')
          .select('id, name')
          .in('id', productIds);
        if (prodErr) throw prodErr;
        for (const p of (prodData ?? []) as Array<{ id: string; name: string }>) {
          nameMap.set(p.id, p.name);
        }
      }

      return rows.map((r) => mapRow(r, nameMap));
    },
  });
}

export interface AcknowledgeMarginAlertArgs {
  id:    string;
  notes?: string | null;
}

export function useAcknowledgeMarginAlert() {
  const qc = useQueryClient();
  return useMutation<MarginAlertRow, Error, AcknowledgeMarginAlertArgs>({
    mutationFn: async ({ id, notes }) => {
      // user_profiles.id is what we store ; authStore.user.id is exactly that
      // (set at login by loginWithPin).
      const profileId = useAuthStore.getState().user?.id ?? null;

      const payload: { acknowledged_at: string; acknowledged_by: string | null; notes?: string | null } = {
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: profileId,
      };
      if (notes !== undefined) payload.notes = notes;

      const { data, error } = await supabase
        .from('margin_alerts')
        .update(payload)
        .eq('id', id)
        .select(SELECT_COLS)
        .single();
      if (error) throw error;
      const row = data as unknown as RawAlertRow;
      return mapRow(row, new Map<string, string>());
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['margin-alerts'], exact: false });
    },
  });
}
