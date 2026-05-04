// apps/pos/src/features/payment/hooks/useCheckout.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Cart, PaymentInput, PaymentResult } from '@breakery/domain';
import { buildOrderPayload } from '@breakery/domain';
import { supabaseUrl } from '@/lib/supabase';
import { useShiftStore } from '@/stores/shiftStore';
import { usePaymentStore } from '@/stores/paymentStore';

interface CheckoutInput {
  cart: Cart;
  payment: PaymentInput;
}

interface CheckoutResponse {
  order_id: string;
  order_number: string;
  total: number;
  tax_amount: number;
  change_given: number | null;
  idempotent_replay?: boolean;
  error?: string;
}

export function useCheckout() {
  const sessionId = useShiftStore((s) => s.current?.id);
  const idempotencyKey = usePaymentStore((s) => s.idempotencyKey);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CheckoutInput): Promise<PaymentResult> => {
      if (!sessionId) throw new Error('no_open_shift');
      const accessToken = await getAccessToken();
      const payload = buildOrderPayload(sessionId, input.cart, input.payment, idempotencyKey);

      const res = await fetch(`${supabaseUrl}/functions/v1/process-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as CheckoutResponse;
        throw Object.assign(new Error(err.error ?? 'checkout_failed'), { details: err, status: res.status });
      }
      const body = await res.json() as CheckoutResponse;
      return {
        ok: true,
        order_id: body.order_id,
        order_number: body.order_number,
        total: body.total,
        tax_amount: body.tax_amount,
        change_given: body.change_given,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

async function getAccessToken(): Promise<string> {
  const { supabase } = await import('@/lib/supabase');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('no_auth_session');
  return session.access_token;
}
