// apps/backoffice/src/features/reports/hooks/usePriceChanges.ts
// S40 Wave B3 — Query hook for get_price_changes_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

export interface PriceChangeLine {
  changed_at:   string;
  actor_name:   string;
  product_id:   string;
  product_name: string;
  new_price:    number;
  old_price:    number | null;
  delta_pct:    number | null;
}

export interface PriceChangesData {
  period:    { start: string; end: string };
  changes:   PriceChangeLine[];
  truncated: boolean;
}

export interface UsePriceChangesParams {
  start:      string;
  end:        string;
  product_id?: string | null;
}

export function usePriceChanges(params: UsePriceChangesParams) {
  return useQuery<PriceChangesData, Error>({
    queryKey: ['reports', 'price-changes', params.start, params.end, params.product_id ?? null],
    queryFn:  async () => {
      // `exactOptionalPropertyTypes` : on omet la clé quand il n'y a pas de
      // filtre produit — elle tombe sur le DEFAULT NULL de la RPC.
      const args: { p_date_start: string; p_date_end: string; p_product_id?: string } = {
        p_date_start: params.start,
        p_date_end:   params.end,
      };
      if (params.product_id) args.p_product_id = params.product_id;
      const { data, error } = await supabase.rpc('get_price_changes_v1', args);
      if (error) throw error as Error;
      const raw    = asRecord(data);
      const period = asRecord(raw.period);
      return {
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        changes: asArray(raw.changes).map((c): PriceChangeLine => {
          const o = asRecord(c);
          return {
            changed_at:   toStr(o.changed_at),
            actor_name:   toStr(o.actor_name, '—'),
            product_id:   toStr(o.product_id),
            product_name: toStr(o.product_name, '—'),
            new_price:    toNum(o.new_price),
            old_price:    o.old_price == null ? null : toNum(o.old_price),
            delta_pct:    o.delta_pct == null ? null : toNum(o.delta_pct),
          };
        }),
        truncated: raw.truncated === true,
      } satisfies PriceChangesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
