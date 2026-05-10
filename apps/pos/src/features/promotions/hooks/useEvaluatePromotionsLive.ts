// apps/pos/src/features/promotions/hooks/useEvaluatePromotionsLive.ts
// Note: supabase generated types are from session 7; evaluate_promotions RPC not yet typed.
// We cast through `unknown` until types are regenerated after session-8 migrations.
import { useEffect, useRef, useState } from 'react';
import type { EvaluationResult } from '@breakery/domain';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';

interface RpcSupabase {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
}

export function useEvaluatePromotionsLive(): EvaluationResult | null {
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const items = useCartStore((s) => s.cart.items);
  const customerId = useCartStore((s) => s.cart.customerId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (items.length === 0) {
      setResult({ applied_promotion: null, skipped_promotions: [] });
      return;
    }

    timerRef.current = setTimeout(() => {
      const p_items = items.map((i) => ({
        product_id: i.product_id,
        qty: i.quantity,
        unit_price: i.unit_price,
        modifier_total: i.modifiers?.reduce((s, m) => s + (m.price_adjustment ?? 0), 0) ?? 0,
        manual_discount_amount: i.discount?.amount ?? 0,
      }));
      const client = supabase as unknown as RpcSupabase;
      if (typeof client.rpc !== 'function') return;
      void client
        .rpc('evaluate_promotions', {
          p_items,
          p_customer_id: customerId ?? null,
          p_evaluation_ts: new Date().toISOString(),
        })
        .then(({ data, error }) => {
          if (!error && data) setResult(data as EvaluationResult);
        });
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [items, customerId]);

  return result;
}
