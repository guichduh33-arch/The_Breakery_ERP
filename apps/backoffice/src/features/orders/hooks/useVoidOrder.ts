// apps/backoffice/src/features/orders/hooks/useVoidOrder.ts
// Session 33 / Wave 2.5 — BO version of POS apps/pos/src/features/order-history/hooks/useVoidOrder.
// Per DEV-S33-PRE-02: void-order EF accepts manager_pin in body (S25 only
// hardened refund-order). Header-PIN refactor deferred to backlog.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

interface VoidArgs {
  orderId:    string;
  reason:     string;
  managerPin: string;
}

export interface VoidResponse {
  order_id:       string;
  order_number:   string;
  refund_id:      string;
  refund_number:  string;
  total_refunded: number;
  tax_refunded:   number;
  error?:         string;
  message?:       string;
}

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('no_auth_session');
  return session.access_token;
}

export function useVoidOrder() {
  const qc = useQueryClient();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  return useMutation({
    mutationFn: async ({ orderId, reason, managerPin }: VoidArgs): Promise<VoidResponse> => {
      const accessToken = await getAccessToken();
      const res = await fetch(`${supabaseUrl}/functions/v1/void-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ order_id: orderId, reason, manager_pin: managerPin }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as VoidResponse;
        throw Object.assign(new Error(err.error ?? 'void_failed'), { details: err, status: res.status });
      }
      return await res.json() as VoidResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      void qc.invalidateQueries({ queryKey: ['orders', 'detail'] });
    },
  });
}
