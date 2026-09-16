import { calculateTotals, pointsToValue, type AppliedPromotion, type CartItem } from '@breakery/domain';
import type { CartState } from './cartTypes';
interface GiftChange { name: string; promotion_id: string }
function makeGiftLineId(promotionId: string): string { return `gift-${promotionId}`; }
export function reconcilePromotions(state: CartState, next: AppliedPromotion[], productLookup: Record<string, { name: string }> = {}): { patch: Partial<CartState>; addedGifts: GiftChange[]; removedGifts: GiftChange[] } {
        const addedGifts: { name: string; promotion_id: string }[] = [];
        const removedGifts: { name: string; promotion_id: string }[] = [];


        const nextById = new Map(next.map((ap) => [ap.promotion_id, ap]));

        // Index existing gift lines by promotion_id for fast lookup.
        const existingGiftPromoIds = new Set<string>();
        for (const it of state.cart.items) {
          if (it.is_promo_gift && it.promotion_id) {
            existingGiftPromoIds.add(it.promotion_id);
          }
        }

        // 1. Drop gift lines whose promotion is no longer applied.
        let nextItems: CartItem[] = state.cart.items.filter((it) => {
          if (!it.is_promo_gift || !it.promotion_id) return true;
          const stillApplied = nextById.has(it.promotion_id);
          if (!stillApplied) {
            removedGifts.push({ name: it.name, promotion_id: it.promotion_id });
          }
          return stillApplied;
        });

        // 2. Add gift lines for newly-applied free_product promos.
        for (const ap of next) {
          if (!ap.gift_to_add) continue;
          if (existingGiftPromoIds.has(ap.promotion_id)) continue;
          const giftName = productLookup[ap.gift_to_add.product_id]?.name ?? ap.name;
          const giftLine: CartItem = {
            id: makeGiftLineId(ap.promotion_id),
            product_id: ap.gift_to_add.product_id,
            name: giftName,
            unit_price: 0,
            quantity: ap.gift_to_add.qty,
            modifiers: [],
            is_promo_gift: true,
            promotion_id: ap.promotion_id,
          };
          nextItems = [...nextItems, giftLine];
          addedGifts.push({ name: giftName, promotion_id: ap.promotion_id });
        }

        // ADR-013 D11 — la promo entre dans le pipeline canonique du domaine :
        // `cart.promotionTotal` est écrit ICI (source unique), les call-sites
        // appellent `calculateTotals` sans post-traitement. Clamp du rachat de
        // points dans le MÊME set : l'éval promo est asynchrone (debounce +
        // RPC), un rachat validé avant l'arrivée d'une promo peut dépasser le
        // post-promo — on le réduit au max valide pour que les gardes du
        // domaine (RedemptionExceedsTotalError) restent un filet jamais touché.
        // items_total exact du domaine (lignes annulées exclues, remises
        // ligne déduites) sur un cart nu — aucune garde ne peut throw ici.
        const itemsTotal = calculateTotals(
          { items: nextItems, order_type: state.cart.order_type },
          0,
        ).subtotal;
        // Promo clampée aux items : un montant évalué > items_total (petit
        // panier + fixed_amount généreux) ne doit jamais mettre le cart dans
        // un état où DiscountExceedsTotalError throw au render.
        const promoTotal = Math.min(
          next.reduce((sum, ap) => sum + ap.amount, 0),
          itemsTotal,
        );
        const promoChanged = (state.cart.promotionTotal ?? 0) !== promoTotal;

        const currentPoints = state.cart.loyaltyPointsToRedeem ?? 0;
        let clampedPoints = currentPoints;
        if (currentPoints > 0) {
          const postPromo = itemsTotal - promoTotal;
          const maxPoints = Math.floor(postPromo / pointsToValue(1));
          clampedPoints = Math.min(currentPoints, maxPoints);
        }
        const pointsChanged = clampedPoints !== currentPoints;

        // Session 36 / Bug 1 fix — idempotent reconcile. When nothing changed,
        // `nextItems` is content-identical to the current cart (only a fresh
        // array instance). Preserve the EXISTING `cart` reference in that case
        // so `usePromotionsAutoEval` (whose effect depends on `cart`) does NOT
        // re-fire and re-call `evaluate_promotions_v2` on a 200ms loop.
        // `appliedPromotions` is not in that effect's deps, so refreshing it is
        // safe. Quand seul `promotionTotal` change, la nouvelle référence cart
        // déclenche UNE éval supplémentaire qui converge (2ᵉ passage : montant
        // identique → référence préservée).
        const giftsChanged = addedGifts.length > 0 || removedGifts.length > 0;
        const cartChanged = giftsChanged || promoChanged || pointsChanged;
        const patch: Partial<CartState> = {
          cart: cartChanged
            ? {
                ...state.cart,
                items: nextItems,
                promotionTotal: promoTotal,
                ...(pointsChanged ? { loyaltyPointsToRedeem: clampedPoints } : {}),
              }
            : state.cart,
          appliedPromotions: next,
        };
        return { patch, addedGifts, removedGifts };
}
