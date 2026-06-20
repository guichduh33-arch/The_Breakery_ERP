// apps/pos/src/features/payment/hooks/useCheckout.ts
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Cart, PaymentInput, PaymentResult } from '@breakery/domain';
import { buildOrderPayload } from '@breakery/domain';
import type { Database, Json } from '@breakery/supabase';

type PayExistingOrderArgs = Database['public']['Functions']['pay_existing_order_v10']['Args'];

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
  // S44 D4 — v12 returns the server-resolved loyalty figures.
  loyalty_points_earned?: number;
  loyalty_balance_after?: number;
  idempotent_replay?: boolean;
  error?: string;
}

export function useCheckout() {
  const sessionId = useShiftStore((s) => s.current?.id);
  const idempotencyKey = usePaymentStore((s) => s.idempotencyKey);
  const queryClient = useQueryClient();

  // S43 P0-3 — append idempotency. This mutation has NO automatic retry
  // (React-Query mutation default `retry: 0`), but usePaymentFlowLogic's
  // handleRetry re-runs mutationFn on retryable failures: an inline
  // crypto.randomUUID() would mint a NEW p_client_uuid on every retry and
  // duplicate the appended lines server-side. We key the append uuid to the
  // payment attempt's idempotencyKey (regenerated on open/close/reset — same
  // lifecycle as the EF x-idempotency-key) so a retry of the SAME attempt
  // replays the SAME uuid → RPC flavor-2 idempotent replay.
  const appendUuidRef = useRef<{ attempt: string; uuid: string } | null>(null);

  return useMutation({
    mutationFn: async (input: CheckoutInput): Promise<PaymentResult> => {
      if (!sessionId) throw new Error('no_open_shift');
      const { useCartStore } = await import('@/stores/cartStore');
      const cartState = useCartStore.getState();
      const { customerId, loyaltyPointsToRedeem, tableNumber, cartDiscount } = cartState.cart;
      const { pickedUpOrderId, appliedPromotions } = cartState;

      // S44 P0-C(2) — the loyalty multiplier is resolved server-side now
      // (complete_order_with_payment_v13 / pay_existing_order_v10). The client no
      // longer computes or forwards it.

      // Session 9 — both branches forward applied promotions to the server,
      // which re-validates eligibility and inserts promotion_applications.
      const promotionPayload: PromotionWirePayload[] = appliedPromotions.map((ap) => ({
        promotion_id: ap.promotion_id,
        amount: ap.amount,
        description: ap.description,
        ...(ap.scope_line_id ? { scope_line_id: ap.scope_line_id } : {}),
      }));

      if (pickedUpOrderId) {
        // S43 P0-3 — fired COUNTER order: items added to the cart after the
        // last fire exist only locally; pay_existing_order_v7 pays the
        // PERSISTED order_items, not the local cart. Append them to the DB
        // order first, or the customer pays a partial total.
        //
        // Counter-only guard: a fired counter order always has non-empty
        // printedItemIds (the fire seals every persisted line locked+printed);
        // a tablet pickup has ALL its items in DB already and printedItemIds
        // empty — appending there would duplicate the whole cart.
        //
        // Locked lines are excluded too: a line locked-but-unprinted was
        // already appended by a previous checkout attempt (markLocked on
        // append success below) — re-sending it would duplicate the DB line
        // even across payment attempts (close/reopen regenerates the
        // idempotencyKey → new p_client_uuid, so the uuid replay alone
        // cannot protect us there).
        const printedIds = cartState.printedItemIds;
        const isCounterFired = printedIds.length > 0;
        const unsynced = cartState.cart.items.filter(
          (i) => !i.is_cancelled
            && !printedIds.includes(i.id)
            && !cartState.lockedItemIds.includes(i.id),
        );
        if (isCounterFired && unsynced.length > 0) {
          if (appendUuidRef.current?.attempt !== idempotencyKey) {
            appendUuidRef.current = { attempt: idempotencyKey, uuid: crypto.randomUUID() };
          }
          // S44 P0-C(3) — fire_counter_order_v4 gates any appended line discount
          // on an authorizing manager (sales.discount). Hoist the first
          // discounted line's authorizer so the gate sees the captured PIN holder.
          const appendAuthorizer = unsynced.find((i) => i.discount?.authorized_by)?.discount?.authorized_by;
          const { error: appendErr } = await supabase.rpc('fire_counter_order_v4', {
            p_client_uuid: appendUuidRef.current.uuid,
            p_session_id: sessionId,
            p_items: unsynced.map((i) => ({
              product_id: i.product_id,
              quantity: i.quantity,
              unit_price: i.unit_price,
              modifiers: i.modifiers,
              // S47 — combo lines persist their components so pay_existing_order_v10
              // deducts each component's stock at payment.
              ...(i.combo_components ? { combo_components: i.combo_components } : {}),
              ...(i.discount ? { discount_amount: i.discount.amount } : {}),
            })) as unknown as Json,
            p_order_id: pickedUpOrderId,
            ...(appendAuthorizer ? { p_discount_authorized_by: appendAuthorizer } : {}),
          });
          if (appendErr) throw Object.assign(new Error(appendErr.message), { details: appendErr });

          // The DB now owns these lines: lock them so a reopen/retry/manual
          // fire can't re-append or edit them. NOT markPrinted — the post-pay
          // printOnly auto-fire computes from unprintedItems() and must still
          // print their prep tickets.
          useCartStore.getState().markLocked(unsynced.map((i) => i.id));
        }

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
          // S44 P0-C(2) — no p_loyalty_multiplier: v9 resolves it server-side.
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
        // S37 — v8 returns a jsonb envelope: the POS finally shows the REAL
        // pickup total instead of the hardcoded 0 (POS-01).
        const { error, data } = await supabase.rpc('pay_existing_order_v10', args as PayExistingOrderArgs);
        if (error) throw Object.assign(new Error(error.message), { details: error });
        const envelope = data as unknown as {
          order_id: string;
          order_number: string;
          subtotal: number;
          tax_amount: number;
          total: number;
          change_given: number | null;
          loyalty_points_earned?: number;
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
          // S44 D4 — v8 returns points_earned (no balance_after on the pickup path).
          ...(envelope.loyalty_points_earned != null ? { loyalty_points_earned: envelope.loyalty_points_earned } : {}),
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
      const payload = buildOrderPayload(
        sessionId,
        cartWithLoyalty,
        input.payment,
        idempotencyKey,
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
        // S44 D4 — v12 envelope carries the server-resolved loyalty figures.
        ...(body.loyalty_points_earned != null ? { loyalty_points_earned: body.loyalty_points_earned } : {}),
        ...(body.loyalty_balance_after != null ? { loyalty_balance_after: body.loyalty_balance_after } : {}),
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
