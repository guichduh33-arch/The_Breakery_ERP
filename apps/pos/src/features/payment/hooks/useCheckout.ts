// apps/pos/src/features/payment/hooks/useCheckout.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Cart, PaymentInput, PaymentResult } from '@breakery/domain';
import { buildOrderPayload, TIERS, tierFromLifetime } from '@breakery/domain';
import type { Json } from '@breakery/supabase';
import { supabase, supabaseUrl } from '@/lib/supabase';
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
      const { useCartStore } = await import('@/stores/cartStore');
      const cartState = useCartStore.getState();
      const { customerId, loyaltyPointsToRedeem, tableNumber, cartDiscount } = cartState.cart;
      const { attachedCustomer, pickedUpOrderId } = cartState;

      const tier = attachedCustomer ? tierFromLifetime(attachedCustomer.lifetime_points) : null;
      const tierMultiplier = tier ? (TIERS.find((t) => t.tier === tier)?.points_multiplier ?? 1.0) : 1.0;
      const categoryMultiplier = attachedCustomer?.category?.points_multiplier ?? 1.0;
      const multiplier = tierMultiplier * categoryMultiplier;

      if (pickedUpOrderId) {
        const { error, data } = await supabase.rpc('pay_existing_order', {
          p_order_id: pickedUpOrderId,
          p_payment: input.payment as unknown as Json,
          p_customer_id: customerId ?? null,
          p_loyalty_points_redeemed: loyaltyPointsToRedeem ?? 0,
          p_idempotency_key: idempotencyKey ?? null,
          p_discount_amount: cartDiscount?.amount ?? 0,
          p_discount_type: cartDiscount?.type ?? null,
          p_discount_value: cartDiscount?.value ?? null,
          p_discount_reason: cartDiscount?.reason ?? null,
          p_discount_authorized_by: cartDiscount?.authorized_by ?? null,
          p_loyalty_multiplier: multiplier,
        });
        if (error) throw Object.assign(new Error(error.message), { details: error });
        return {
          ok: true,
          order_id: pickedUpOrderId,
          order_number: (data as { order_number?: string })?.order_number ?? '',
          total: 0,
          tax_amount: 0,
          change_given: null,
        };
      }

      const accessToken = await getAccessToken();
      const cartWithLoyalty: typeof input.cart = {
        ...input.cart,
        ...(customerId ? { customerId } : {}),
        ...(loyaltyPointsToRedeem ? { loyaltyPointsToRedeem } : {}),
        ...(tableNumber ? { tableNumber } : {}),
        ...(cartDiscount ? { cartDiscount } : {}),
      };
      const lifetimePoints = attachedCustomer?.lifetime_points;
      // Session 8: pass evaluation_ts so EF can re-evaluate promotions server-side (freeze semantics)
      const evaluationTs = new Date().toISOString();
      const payload = buildOrderPayload(sessionId, cartWithLoyalty, input.payment, idempotencyKey, lifetimePoints, multiplier, evaluationTs);

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
  const { getSupabaseAccessToken } = await import('@breakery/supabase');
  const token = getSupabaseAccessToken();
  if (!token) throw new Error('no_auth_session');
  return token;
}
