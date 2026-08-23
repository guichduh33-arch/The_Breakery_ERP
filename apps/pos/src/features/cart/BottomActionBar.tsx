// apps/pos/src/features/cart/BottomActionBar.tsx
//
// Global POS action bar (bottom of the shell, full width). It concentrates ALL
// order actions that used to live inside the Active Order panel:
//
//   left  : Held Orders · Tablet inbox · Customer · Table · Print Bill · More(▾) · Void Order
//   right : Send to Kitchen · Checkout (+ total)
//   (Void lives LEFT of the spacer — destructive stays out of the rush reflex
//   zone next to Send/Checkout. Below md the bar wraps and the validation pair
//   becomes a full-width bottom row, Checkout stretched — waiter one-hand use.)
//
// It is a *connected* component — it reuses the existing hooks / self-contained
// button components (no business logic is rewritten here):
//   - SendToKitchenButton / PrintBillButton / TableSelectorButton
//     are rendered restyled (className/variant overrides).
//   - useApplyCartDiscount drives the cart-discount modal (+ manager PIN).
//   - RedeemPointsModal / HeldOrdersModal are owned here.
//   - Checkout opens the payment terminal (paymentStore.open).
//   - Void Order maps to cartStore.clear (wipes unlocked items) — see the
//     deviation note in the PR description (no dedicated POS "void order" flow).

import { useEffect, useRef, useState, type JSX } from 'react';
import {
  Clock,
  CreditCard,
  MoreHorizontal,
  PauseCircle,
  Percent,
  Star,
  Trash2,
  User,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Currency,
  DiscountModal,
  PinVerificationModal,
  RedeemPointsModal,
  cn,
} from '@breakery/ui';
import { calculateTotals } from '@breakery/domain';
import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useCurrentShift } from '@/features/shift/hooks/useShift';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';
import { usePOSPresets } from '@/features/settings/hooks/usePOSPresets';
import { useHeldOrdersQuery } from '@/features/heldOrders/hooks/useHeldOrdersQuery';
import { useHoldFiredOrder } from './hooks/useHoldFiredOrder';
import { useApplyCartDiscount } from '@/features/discounts/hooks/useApplyCartDiscount';
import { useVerifyManagerPin } from '@/features/discounts/hooks/useVerifyManagerPin';
import { useVoidServerOrder } from './hooks/useVoidServerOrder';
import { TableSelectorButton } from '@/features/tables/components/TableSelectorButton';
import { useDineInTableGuard } from '@/features/tables/hooks/useDineInTableGuard';
import { TabletInboxButton } from '@/features/inbox/components/TabletInboxButton';
import { usePendingTabletOrders } from '@/features/inbox/hooks/usePendingTabletOrders';
import { SendToKitchenButton } from './SendToKitchenButton';
import { PrintBillButton } from './PrintBillButton';
import { HeldOrdersModal } from './HeldOrdersModal';
import { VoidOrderModal } from './VoidOrderModal';

/** Shared "ghost" management-button styling (left group). */
const GHOST_BTN =
  'flex items-center gap-2 h-11 px-3.5 rounded-md bg-bg-overlay border border-border-subtle ' +
  'text-text-primary text-sm font-semibold hover:bg-bg-input ' +
  'transition-[color,background-color,transform] duration-fast ease-motion-out active:scale-[0.98] motion-reduce:active:scale-100 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ' +
  'disabled:opacity-50 disabled:pointer-events-none';

// Critique run 4 lot 3 — h-10 (40 px) était sous le plancher tactile de 44,
// et ce menu porte « Void order ».
const MENU_ITEM =
  'w-full flex items-center gap-3 px-3 h-11 text-sm text-text-primary hover:bg-bg-input ' +
  'disabled:opacity-50 disabled:pointer-events-none rounded-md transition-colors';

interface BottomActionBarProps {
  /** Opens the customer search/attach modal (owned by the POS shell). */
  onOpenCustomerSearch?: () => void;
  /**
   * Critique run 4 lot 8 — shift-gate (décision C du 2026-08-15). Ouvre le
   * formulaire d'ouverture de session (possédé par le shell POS, comme pour le
   * terminal de paiement). Les deux gestes qui ENGAGENT — encaisser, envoyer en
   * cuisine — y mènent tant qu'aucune session n'est ouverte.
   */
  onOpenShift?: () => void;
}

export function BottomActionBar({
  onOpenCustomerSearch,
  onOpenShift,
}: BottomActionBarProps): JSX.Element {
  const cart = useCartStore((s) => s.cart);
  const lockedItemIds = useCartStore((s) => s.lockedItemIds);
  const pickedUpOrderId = useCartStore((s) => s.pickedUpOrderId);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const setRedeemPoints = useCartStore((s) => s.setRedeemPoints);
  const voidOrder = useCartStore((s) => s.voidOrder);
  const openPayment = usePaymentStore((s) => s.open);

  const heldCount = useHeldOrdersQuery().data?.length ?? 0;
  const holdFired = useHoldFiredOrder();
  // Critique run 4 lot 8 — shift-gate (décision C du 2026-08-15). Même source
  // que le filet client de useCheckout (`no_open_shift` sur useShiftStore) :
  // la garde ne peut donc jamais contredire ce que le money-path fera.
  // useCurrentShift ne sert qu'à distinguer « pas de session » de « on ne sait
  // pas encore » — pendant le vol de la requête, on n'accuse pas.
  const { isLoading: shiftLoading } = useCurrentShift();
  const currentShift = useShiftStore((s) => s.current);
  const needsShift = !shiftLoading && !currentShift;
  // Fiche 02 D2.5 — a dine-in order can be paid directly without a fire; the
  // checkout CTA carries the same mandatory-table guard as Send to Kitchen.
  const checkoutTableGuard = useDineInTableGuard({ onSelected: () => openPayment() });
  const discount = useApplyCartDiscount();
  const { presets: posPresets } = usePOSPresets();
  const verifyManagerPin = useVerifyManagerPin();
  const voidServerOrder = useVoidServerOrder();
  const pendingTablet = usePendingTabletOrders().data?.length ?? 0;

  const [heldOpen, setHeldOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidPending, setVoidPending] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close the More popover on outside click + Escape.
  useEffect(() => {
    if (!moreOpen) return;
    function onDocClick(e: MouseEvent) {
      // S43 P2-2: dialogs opened from menu items (e.g. the hold-note modal)
      // are portaled to <body>. Clicking inside them must NOT close the menu
      // — that would unmount the menu item that owns the dialog.
      const target = e.target as Element | null;
      if (target?.closest?.('[role="dialog"], [role="alertdialog"]')) return;
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // Amount due on the checkout bar — ADR-013 D11 : la promo vit dans
  // `cart.promotionTotal`, calculateTotals applique l'ordre canonique
  // items → promo → redemption → remise → taxe (split PB1 unique, config
  // serveur) ; plus aucun post-traitement ici.
  const { taxRate, taxInclusive } = useTaxConfig();
  const baseTotals = calculateTotals(cart, taxRate, taxInclusive);
  const { total } = baseTotals;

  const hasItems = cart.items.some((i) => !i.is_cancelled);
  const hasSentItems = lockedItemIds.length > 0;

  // Spec A fix — re-hold a reopened FIRED order ("addition ouverte") even when
  // nothing changed. After reopen_held_order_v1 the order sits on the terminal
  // (pickedUpOrderId set, all lines locked); Send-to-Kitchen is disabled with no
  // new items to fire, and the draft Hold path would orphan the live DB row. So
  // when a fired order is open with no unfired lines, "Hold" re-parks it via
  // hold_fired_order_v1 and frees the terminal. New unfired lines must go through
  // Send to Kitchen first (it fires + parks).
  const hasFiredOrderOpen = pickedUpOrderId !== null;
  const hasUnfiredItems = cart.items.some(
    (i) => !i.is_cancelled && !lockedItemIds.includes(i.id),
  );

  // ADR-022 déc. 4 — « mettre en attente » n'existe plus que pour une commande
  // ENVOYÉE en cuisine. Le bouton reste visible quand rien n'est envoyé, mais
  // désactivé et explicite : il enseigne le nouveau parcours au lieu de
  // disparaître sans raison.
  const holdTitle = !hasFiredOrderOpen
    ? 'Send the order to the kitchen first, then hold it'
    : hasUnfiredItems
      ? 'Send the new items to the kitchen first'
      : '';

  async function handleReholdFired(): Promise<void> {
    if (!pickedUpOrderId) return;
    try {
      await holdFired.mutateAsync(pickedUpOrderId);
      resetCartAfterCheckout();
      toast.success('Order held');
    } catch {
      toast.error('Could not hold order');
    }
  }

  // Critique run 4 lot 8 — shift-gate (décision C du 2026-08-15). Composer une
  // commande reste libre pendant que le fond de caisse se compte ; le geste qui
  // ENGAGE mène à l'ouverture de session au lieu d'ouvrir le terminal pour
  // échouer sur `no_open_shift` au bout du parcours. Ordre imposé : la garde de
  // session passe AVANT la garde de table (fiche 02 D2.5) — faire choisir une
  // table pour une vente qui ne peut pas aboutir serait un détour inutile. La
  // reprise du plan de salle (`onSelected`) n'est atteignable qu'une fois cette
  // garde franchie, elle n'a donc pas à la refaire.
  function handleCheckout(): void {
    if (needsShift) {
      toast.info('No shift open — opening the shift form.');
      onOpenShift?.();
      return;
    }
    if (checkoutTableGuard.ensureTable()) openPayment();
  }

  // Void Order (owner decision 2026-07-10) — lives under "More" and ALWAYS
  // requires a manager PIN + a mandatory reason, whether or not anything was
  // fired. Accidental voids become impossible and every void is attributable.
  //   - fired (server row exists) → void-order EF verifies the PIN + records the
  //     reason server-side (useVoidServerOrder).
  //   - never fired → verify the PIN client-side, then wipe the local cart.
  // Throws propagate so VoidOrderModal keeps the modal open + clears the PIN.
  async function handleVoidSubmit({
    reason,
    managerPin,
    idempotencyKey,
  }: {
    reason: string;
    managerPin: string;
    idempotencyKey: string;
  }): Promise<void> {
    setVoidPending(true);
    try {
      if (pickedUpOrderId) {
        // Server row exists (tablet pickup OR fired counter order) → the
        // void-order EF verifies the PIN + records the reason server-side.
        await voidServerOrder(managerPin, reason, idempotencyKey);
        toast.success('Order voided (manager approved)');
      } else {
        // No server row → verify the PIN client-side, then wipe locally.
        await verifyManagerPin(managerPin); // throws on invalid PIN
        voidOrder();
        toast.info(`Order voided — ${reason}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'void_failed';
      toast.error(`Void failed: ${msg}`);
      throw err;
    } finally {
      setVoidPending(false);
    }
  }

  return (
    <div
      // Règle du Filet (critique run 3) : la barre se détache par sa surface et
      // son border-t, pas par une ombre portée — supprimée.
      // Audit 2026-08-24 (responsive P1) — safe-area : la barre porte Checkout,
      // qui passait sous la barre gestuelle Android en Capacitor.
      className="shrink-0 bg-bg-elevated border-t border-border-subtle px-4 py-2.5 flex items-center gap-2 max-md:flex-wrap z-50"
      style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))' }}
      role="toolbar"
      aria-label="Order actions"
    >
      {/* ── Left group : management ─────────────────────────────────────────
          Wraps to a second row before it can push the validation pair off the
          right edge — this is what fixes the Checkout/total truncation (#14):
          the group is `min-w-0 flex-wrap`, the validation pair is `shrink-0`. */}
      <div className="flex flex-wrap items-center gap-2 min-w-0 max-md:w-full">
        {/* Critique run 4 lot 5 — même contrat que Hold : indisponible ≠
            disabled. Un bouton mort au doigt n'explique rien ; celui-ci reste
            tapable et enseigne le parcours quand la liste est vide. */}
        <button
          type="button"
          className={`${GHOST_BTN} ${heldCount === 0 ? 'opacity-50' : ''}`}
          aria-disabled={heldCount === 0}
          onClick={() => {
            if (heldCount === 0) {
              toast.info('No held orders — send an order to the kitchen, then tap Hold to park it here.');
              return;
            }
            setHeldOpen(true);
          }}
        >
          <Clock className="h-4 w-4 text-gold" aria-hidden />
          <span>Held Orders</span>
          {heldCount > 0 && (
            <span
              className="ml-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gold text-gold-fg text-xs font-bold"
              aria-label={`${heldCount} held order${heldCount === 1 ? '' : 's'}`}
            >
              {heldCount}
            </span>
          )}
        </button>

        {/* HOLD — first-class (owner decision 2026-07-10: a cashier who reopens
            an order to check it must be able to re-park it without hunting a
            submenu).
            ADR-022 déc. 4 — la branche « panier neuf → draft HELD-<uuid> » est
            supprimée avec la famille hold_order : un objet qui porte un numéro
            de commande sans en être une polluait rapports, journal, listes et
            rapprochement de caisse. Une commande n'existe qu'à partir du moment
            où elle part en cuisine ou qu'elle est payée ; le geste passe donc
            par l'envoi en cuisine, puis hold_fired_order_v1. */}
        {/* Critique run 2 (2026-08-14 P2) — un `title` n'existe pas au doigt et
            un bouton `disabled` n'émet aucun événement : l'état « indisponible »
            reste TAPABLE et explique le parcours au tap (même pattern que la
            garde de table dine-in). Seul l'envoi en cours désactive vraiment. */}
        <button
          type="button"
          className={`${GHOST_BTN} ${holdTitle ? 'opacity-50' : ''}`}
          disabled={holdFired.isPending}
          aria-disabled={holdTitle !== ''}
          {...(holdTitle ? { title: holdTitle } : {})}
          onClick={() => {
            if (holdTitle) { toast.info(holdTitle); return; }
            void handleReholdFired();
          }}
        >
          <PauseCircle className="h-4 w-4 text-gold" aria-hidden />
          <span>Hold</span>
        </button>

        <button type="button" className={GHOST_BTN} onClick={() => onOpenCustomerSearch?.()}>
          {attachedCustomer ? (
            <User className="h-4 w-4 text-gold" aria-hidden />
          ) : (
            <UserPlus className="h-4 w-4 text-gold" aria-hidden />
          )}
          <span className="max-w-[140px] truncate">
            {attachedCustomer ? attachedCustomer.name : 'Customer'}
          </span>
        </button>

        <TableSelectorButton variant="secondary" className={GHOST_BTN} />

        {/* More — lower-frequency + destructive actions consolidated here so the
            bar stays scannable and never overflows (#13/#14). A badge surfaces
            pending tablet orders so the signal isn't lost inside the menu. */}
        <div className="relative" ref={moreRef}>
          <button
            type="button"
            className={GHOST_BTN}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <MoreHorizontal className="h-4 w-4 text-gold" aria-hidden />
            <span>More</span>
            {pendingTablet > 0 && (
              <span
                className="ml-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gold text-gold-fg text-xs font-bold"
                aria-label={`${pendingTablet} pending tablet order${pendingTablet === 1 ? '' : 's'}`}
              >
                {pendingTablet}
              </span>
            )}
          </button>
          {moreOpen && (
            /* Critique run 4 lot 2 (harden) — role=menu promettait flèches +
               Escape (WCAG 4.1.2) ; un groupe de boutons dit ce que le clavier
               sait faire : Tab + Enter. */
            <div
              role="group"
              aria-label="More actions"
              className="absolute bottom-full left-0 mb-2 w-60 p-1 rounded-md bg-bg-elevated border border-border-subtle shadow-lg z-50"
            >
              {/* Self-contained buttons restyled as menu rows (own their modals). */}
              <TabletInboxButton className={MENU_ITEM} />
              <PrintBillButton variant="ghost" className={cn(MENU_ITEM, 'justify-start')} />
              <button
                type="button"
                className={MENU_ITEM}
                disabled={!hasItems}
                onClick={() => {
                  setMoreOpen(false);
                  discount.openDiscountModal();
                }}
              >
                <Percent className="h-4 w-4 text-gold" aria-hidden />
                <span>Apply discount</span>
              </button>
              {attachedCustomer && (
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    setMoreOpen(false);
                    setRedeemOpen(true);
                  }}
                >
                  <Star className="h-4 w-4 text-gold" aria-hidden />
                  <span>Redeem points</span>
                </button>
              )}
              <div className="my-1 border-t border-border-subtle" aria-hidden />
              {/* Void order — destructive, under More, always PIN + reason. */}
              <button
                type="button"
                className={cn(MENU_ITEM, 'text-red-as-text hover:bg-red-soft')}
                disabled={!hasItems}
                onClick={() => {
                  setMoreOpen(false);
                  setVoidOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                <span>Void order</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Spacer — collapses first; the left group wraps before Checkout clips. */}
      <div className="flex-1 min-w-[24px] max-md:hidden" />

      {/* ── Right group : validation ────────────────────────────────────── */}
      {/* LOT 7 (audit 2026-06-25) — visual hierarchy by touch size:
          Checkout dominates ▸ Send ▸ ghosts (h-11). Bigger = more important =
          faster to hit during the rush.
          Critique run 3 (Règle des 56) : la hiérarchie vit dans le `size` du
          Button (lg = 80px ▸ md = 56px, le plancher money-path) — les h-12/h-14
          posés ici en className étaient des classes mortes, écrasées par le
          h-touch-* du size dans la cascade. Ne pas les réintroduire. */}
      {/* Below md the validation pair stacks full-width: Send+Checkout side by
          side can't fit 390px without horizontal scroll (measured 403px), and
          the total must never be truncated. Two stacked full-width rows give
          the waiter maximal one-thumb targets. */}
      <div className="flex items-center gap-2 max-md:w-full max-md:flex-col max-md:items-stretch">
        <SendToKitchenButton
          variant="outlineGold"
          className="px-4 rounded-md text-sm font-bold uppercase tracking-wide"
          // Critique run 4 lot 8 — l'envoi en cuisine engage autant que
          // l'encaissement : même issue, le formulaire d'ouverture de session.
          {...(onOpenShift ? { onRequireShift: onOpenShift } : {})}
        />

        {/* CTA colour rule (intentional, do NOT "fix" to match the terminal):
            GOLD = "navigate toward the money" (Checkout opens the payment terminal).
            GREEN = "commit the money" (PaymentTerminal's Process Payment — the
            irreversible final action, where green reads as the universal "go"). */}
        <Button
          variant="gold"
          size="lg"
          className="shrink-0 px-7 gap-2.5 text-base font-bold uppercase tracking-wide active:bg-gold-pressed max-md:px-4"
          onClick={handleCheckout}
          disabled={!hasItems}
          // Tapable-et-explique : sans session le bouton reste vivant et MÈNE à
          // l'ouverture de session ; un `disabled` laisserait le caissier
          // pousser un bouton mort sans jamais apprendre pourquoi.
          aria-disabled={needsShift}
          data-testid="checkout-cta"
        >
          <CreditCard className="h-5 w-5" aria-hidden />
          <span>Checkout</span>
          <Currency amount={total} className="font-mono" />
        </Button>
      </div>

      {/* ── Owned modals ────────────────────────────────────────────────── */}
      {checkoutTableGuard.modal}
      <HeldOrdersModal open={heldOpen} onClose={() => setHeldOpen(false)} />

      {/* Void Order — single reason+PIN gate for BOTH paths (owner decision
          2026-07-10). Fired → void-order EF (server-side PIN + reason). Never
          fired → PIN verified client-side then local wipe. */}
      <VoidOrderModal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        fired={hasSentItems}
        isPending={voidPending}
        onSubmit={handleVoidSubmit}
      />

      <DiscountModal
        open={discount.discountModalOpen}
        onClose={discount.closeDiscountModal}
        onConfirm={discount.onConfirm}
        base={discount.base}
        onRequireAuthorization={discount.onRequireAuthorization}
        presets={posPresets.discountPresets}
      />
      <PinVerificationModal
        open={discount.pinModalOpen}
        onClose={discount.onPinClose}
        onVerified={discount.onPinVerified}
        verifyFn={discount.verifyFn}
      />

      {attachedCustomer && (
        <RedeemPointsModal
          open={redeemOpen}
          onClose={() => setRedeemOpen(false)}
          onConfirm={(points) => {
            setRedeemPoints(points);
            setRedeemOpen(false);
          }}
          customerBalance={attachedCustomer.loyalty_points}
          // ADR-013 D11 — plafond de rachat POST-PROMO (règle canonique :
          // redemption ≤ items − promotions), plus le subtotal brut.
          itemsTotal={Math.max(0, baseTotals.subtotal - (cart.promotionTotal ?? 0))}
        />
      )}
    </div>
  );
}
