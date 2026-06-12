// apps/pos/src/features/payment/hooks/useCheckout.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Cart, PaymentInput, PaymentResult } from '@breakery/domain';
import { buildOrderPayload, TIERS, tierFromLifetime } from '@breakery/domain';
import type { Database } from '@breakery/supabase';

type PayExistingOrderArgs = Database['public']['Functions']['pay_existing_order_v7']['Args'];

/** Wire-format row sent as `p_promotions` to RPC v7 / v4 (§3.6). */
interface PromotionWirePayload {
  promotion_id: string;
  amount: number;
  description: string;
  scope_line_id?: string;
}
import { supabase, supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';
import { useShiftStore } from '@/stores/shiftStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { clearManagerPin, getManagerPin } from '@/features/discounts/managerPinHolder';

interface CheckoutInput {
  cart: Cart;
  /**
   * Single PaymentInput (legacy v7) OR an array of Tenders (session 10 split-pay).
   * Forwarded to buildOrderPayload which wires it as `payment` or `payments`.
   */
  payment: PaymentInput | PaymentInput[];
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
      const { attachedCustomer, pickedUpOrderId, appliedPromotions } = cartState;

      const tier = attachedCustomer ? tierFromLifetime(attachedCustomer.lifetime_points) : null;
      const tierMultiplier = tier ? (TIERS.find((t) => t.tier === tier)?.points_multiplier ?? 1.0) : 1.0;
      const categoryMultiplier = attachedCustomer?.category?.points_multiplier ?? 1.0;
      const multiplier = tierMultiplier * categoryMultiplier;

      // Session 9 — both branches forward applied promotions to the server,
      // which re-validates eligibility and inserts promotion_applications.
      const promotionPayload: PromotionWirePayload[] = appliedPromotions.map((ap) => ({
        promotion_id: ap.promotion_id,
        amount: ap.amount,
        description: ap.description,
        ...(ap.scope_line_id ? { scope_line_id: ap.scope_line_id } : {}),
      }));

      if (pickedUpOrderId) {
        // Session 11 — tablet pay_existing_order v5 supports multi-tender. We forward
        // either p_payment (single) or p_payments (array). Server raises if both are
        // supplied, so we choose exactly one based on the input shape.
        const isArray = Array.isArray(input.payment);
        const singlePayment = isArray ? null : (input.payment as PaymentInput);
        const arrayPayments = isArray ? (input.payment as PaymentInput[]) : null;

        // exactOptionalPropertyTypes is on — optional RPC args must be omitted,
        // not passed as `undefined`. Build the args object conditionally.
        const args: Record<string, unknown> = {
          p_order_id: pickedUpOrderId,
          p_loyalty_points_redeemed: loyaltyPointsToRedeem ?? 0,
          p_discount_amount: cartDiscount?.amount ?? 0,
          p_loyalty_multiplier: multiplier,
        };
        if (singlePayment) args.p_payment = singlePayment;
        if (arrayPayments) args.p_payments = arrayPayments;
        if (customerId) args.p_customer_id = customerId;
        if (idempotencyKey) args.p_idempotency_key = idempotencyKey;
        if (cartDiscount?.type) args.p_discount_type = cartDiscount.type;
        if (cartDiscount?.value != null) args.p_discount_value = cartDiscount.value;
        if (cartDiscount?.reason) args.p_discount_reason = cartDiscount.reason;
        if (cartDiscount?.authorized_by) args.p_discount_authorized_by = cartDiscount.authorized_by;
        if (promotionPayload.length > 0) {
          args.p_promotions = promotionPayload;
        }
        // S37 — v7 returns a jsonb envelope: the POS finally shows the REAL
        // pickup total instead of the hardcoded 0 (POS-01).
        const { error, data } = await supabase.rpc('pay_existing_order_v7', args as PayExistingOrderArgs);
        if (error) throw Object.assign(new Error(error.message), { details: error });
        const envelope = data as unknown as {
          order_id: string;
          order_number: string;
          subtotal: number;
          tax_amount: number;
          total: number;
          change_given: number | null;
          idempotent_replay: boolean;
        };
        clearManagerPin();
        return {
          ok: true,
          order_id: envelope.order_id ?? pickedUpOrderId,
          order_number: envelope.order_number ?? '',
          total: envelope.total ?? 0,
          tax_amount: envelope.tax_amount ?? 0,
          change_given: envelope.change_given ?? null,
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
      const payload = buildOrderPayload(
        sessionId,
        cartWithLoyalty,
        input.payment,
        idempotencyKey,
        lifetimePoints,
        multiplier,
        appliedPromotions,
      );

      // S37 SEC-01 — when a discount was authorized, relay the manager PIN via
      // header (S25 pattern, never in the JSON body); RPC v11 re-validates it.
      const managerPin = getManagerPin();
      const hasDiscount = Boolean(cartDiscount) || input.cart.items.some((i) => i.discount);
      const res = await fetch(`${supabaseUrl}/functions/v1/process-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(hasDiscount && managerPin ? { 'x-manager-pin': managerPin } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as CheckoutResponse;
        const code = err.error ?? 'checkout_failed';
        // S38 — `account_locked` (manager hit 5 failed discount PINs) is mapped to a
        // dedicated French message by classifyCheckoutError via the `account_locked`
        // code; we just forward the envelope so `details.error` carries the code.
        throw Object.assign(new Error(code), { details: err, status: res.status });
      }
      const body = await res.json() as CheckoutResponse;
      clearManagerPin();
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
