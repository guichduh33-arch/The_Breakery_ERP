import { LocalCustomerDisplay } from './LocalCustomerDisplay';
// apps/pos/src/features/display/CustomerDisplayPage.tsx
//
// Session 13 / Phase 4.C — D-4C-4, D-4C-6, D-4C-7.
//
// Root page for the customer-display surface (route `/display`). The route
// is publicly navigable but Supabase calls require a kiosk-scope JWT issued
// by the `kiosk-issue-jwt` Edge Function. State machine :
//
//   authenticating → authenticated → realtime/orders refresh on tick.
//                  ↘ pin_fallback  → render PairDevicePrompt (D-4C-7).
//
// Scope : branded layout + live cart mirror (left) + queue ticker + featured
// card (right). The cart mirror reflects the active POS cart in real time via
// the same-origin BroadcastChannel (F-007).

import { useEffect, useState } from 'react';

import { lineTotalOf } from '@breakery/domain';
import type { CartItem } from '@breakery/domain';

import { readKioskPairing } from '@/lib/kioskAuth';

import { BrandedLayout } from './components/BrandedLayout';
import { CDBrandPanel } from './components/CDBrandPanel';
import { CDPaymentPanel } from './components/CDPaymentPanel';
import { CurrentOrderCard } from './components/CurrentOrderCard';
import { OrderQueueTicker } from './components/OrderQueueTicker';
import { PairDevicePrompt } from './components/PairDevicePrompt';
import { ShowcasePanel } from './components/ShowcasePanel';
import { CustomerDisplayView, type CustomerDisplayLine } from './CustomerDisplayView';
import { useCartBroadcastReceiver } from './hooks/useCartBroadcastReceiver';
import { useKioskAuth } from './hooks/useKioskAuth';
import { useKioskDisplayData } from './hooks/useKioskDisplayData';

/** Built-in idle footer used when no custom message is configured. */
const DEFAULT_DISPLAY_FOOTER = 'Open daily · 07:00 — 21:00';

/** Design Wave C — if no cart broadcast lands for this long, the mirror is
 *  considered stale and the display falls back to the idle/pickup-queue view
 *  rather than freezing on a cart the cashier abandoned. Each new broadcast
 *  resets the timer, so an actively-rung cart never trips it. */
const CART_FRESHNESS_MS = 5 * 60 * 1_000;

// Kiosk-issue-jwt error codes → human copy (critique 2026-08-14 — the screen
// used to greet with the raw code, e.g. "(kiosk_unpaired)", on a surface that
// faces the customer once mounted). Unknown codes fall back to a generic line;
// never echo the code itself.
function pairingErrorCopy(code: string | null): string {
  switch (code) {
    case 'kiosk_unpaired':
      return 'This display is not paired yet — enter the pairing code to connect it.';
    case 'kiosk_revoked':
      return 'This display was unpaired by a manager — enter a new pairing code.';
    case 'kiosk_unavailable':
      return 'Cannot reach the server — check the network, then re-enter the pairing code.';
    case 'ip_not_allowed':
      return "This device's network is not allowed for kiosk screens — ask a manager to check the network settings.";
    default:
      return 'Pairing check failed — re-enter the pairing code.';
  }
}

export default function CustomerDisplayPage() {
  const source = new URLSearchParams(window.location.search).get('source');
  return source ? <LocalCustomerDisplay source={source} /> : <KioskCustomerDisplayPage />;
}

function KioskCustomerDisplayPage() {
  const auth = useKioskAuth();
  const [pairedCode, setPairedCode] = useState<string | null>(null);
  const [pairingChecked, setPairingChecked] = useState(false);

  // Resolve the screenId (= kiosk_id = display_screens.code) from local
  // storage. We do this once on mount + after a successful pair.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pair = await readKioskPairing();
      if (!cancelled) {
        setPairedCode(pair?.kiosk_id ?? null);
        setPairingChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  const snapshot = useKioskDisplayData(pairedCode, auth.status === 'authenticated');
  const showReadyOrders = snapshot.data?.show_ready_orders === true;
  const footer = snapshot.data?.footer ?? '';
  const idleFooter = footer.length > 0 ? footer : DEFAULT_DISPLAY_FOOTER;
  const showcaseProducts = snapshot.data?.products ?? [];
  const orders = snapshot.data?.orders ?? [];
  const mergedReadyOrders = snapshot.data?.ready_orders ?? [];

  // Live cart mirror from the POS side (F-007). Safe to read on every render —
  // the view renders its own welcome empty-state when the message is null.
  const cartMessage = useCartBroadcastReceiver();

  // Design Wave C — freshness watchdog. `cartMessage` is a fresh object on
  // every broadcast, so this effect re-arms the timer each time one lands; if
  // none arrives within CART_FRESHNESS_MS, the mirror is flagged stale and we
  // stop rendering the (abandoned) cart. payment_complete auto-reverts in ~8s,
  // well under this window, so it is never affected.
  const [cartStale, setCartStale] = useState(false);
  useEffect(() => {
    if (!cartMessage) {
      setCartStale(false);
      return;
    }
    setCartStale(false);
    const id = setTimeout(() => setCartStale(true), CART_FRESHNESS_MS);
    return () => clearTimeout(id);
  }, [cartMessage]);

  // ----- Render branches -----

  // 1. Initial pairing check still in flight — render branded shell with
  //    a discreet loader.
  if (!pairingChecked) {
    return (
      <BrandedLayout>
        <div
          className="h-full grid place-items-center text-text-secondary text-sm"
          data-testid="display-loading"
        >
          Loading display…
        </div>
      </BrandedLayout>
    );
  }

  // 2. Device unpaired OR kiosk-issue-jwt failed → show pair prompt
  //    (D-4C-4, D-4C-7).
  if (pairedCode === null || auth.status === 'pin_fallback') {
    return (
      <BrandedLayout>
        <PairDevicePrompt
          onPaired={() => {
            void (async () => {
              const pair = await readKioskPairing();
              setPairedCode(pair?.kiosk_id ?? null);
              await auth.retry();
            })();
          }}
          errorHint={auth.status === 'pin_fallback' ? pairingErrorCopy(auth.error) : null}
        />
      </BrandedLayout>
    );
  }

  // 3. Authenticating in progress.
  if (auth.status !== 'authenticated') {
    return (
      <BrandedLayout>
        <div
          className="h-full grid place-items-center text-text-secondary text-sm"
          data-testid="display-authenticating"
        >
          Authenticating display…
        </div>
      </BrandedLayout>
    );
  }

  // Ne jamais continuer à afficher un cache après refus ou panne du contrôle.
  if (snapshot.isError) {
    return <BrandedLayout><PairDevicePrompt onPaired={() => { void auth.retry(); }}
      errorHint="Display access is unavailable. Check the connection or ask an administrator to pair this screen again." /></BrandedLayout>;
  }
  if (!snapshot.data) {
    return <BrandedLayout><p role="status">Loading display…</p></BrandedLayout>;
  }

  // 4a. Checkout takes the FULL screen (design audit 2026-07-07 B4) — while
  //     a sale is being rung up or just completed, the customer's attention
  //     stays on their own order/total, never on the pickup queue. Split-brand
  //     redesign: brand panel (left) + payment confirmation detail (right).
  if (cartMessage?.type === 'payment_complete') {
    return (
      <BrandedLayout footer={<span>{idleFooter}</span>}>
        <div className="h-full flex gap-10" data-testid="display-authenticated">
          <div className="flex-1 min-h-0 flex">
            <CDBrandPanel slogan={snapshot.data?.slogan ?? ''} />
          </div>
          <div className="flex-1 min-h-0 flex">
            <CDPaymentPanel message={cartMessage} />
          </div>
        </div>
      </BrandedLayout>
    );
  }

  if (!cartStale && cartMessage?.type === 'cart_update' && cartMessage.cart.items.length > 0) {
    // The broadcast mirrors the raw CartItem[] — map to the presentational
    // line shape (image_url is not broadcast → BrandMark fallback). The
    // modifier detail (option label + price delta) travels with each item and
    // the line total includes the modifier adjustments (calculateTotals parity).
    const lines: CustomerDisplayLine[] = (cartMessage.cart.items as CartItem[]).map(
      (item) => {
        return {
          id: item.id,
          product_id: item.product_id,
          name: item.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          // Critique 2026-08-29 P1 — lineTotalOf (combos ADR-017 compris) : la
          // recomposition locale ignorait les ajustements de composants et les
          // lignes ne s'additionnaient plus au Total, sur l'écran dont c'est
          // la seule mission.
          line_total: lineTotalOf(item),
          modifiers: item.modifiers.map((m) => ({
            label: m.option_label,
            price_adjustment: m.price_adjustment,
          })),
          is_promo_gift: item.is_promo_gift === true,
          is_cancelled: item.is_cancelled === true,
        };
      },
    );
    return (
      <CustomerDisplayView
        items={lines}
        totals={cartMessage.totals}
        orderLabel={cartMessage.customer?.name ?? null}
      />
    );
  }

  // 4b. Repos — aucune commande en cours. ADR-023 déc. 1 : l'écran est
  //     commercial, pas opérationnel. La file de retrait ne reprend la moitié
  //     droite que si l'interrupteur de la déc. 3 est allumé.
  if (!showReadyOrders) {
    const showcase = showcaseProducts ?? [];
    return (
      <BrandedLayout footer={<span>{idleFooter}</span>}>
        <div className="h-full flex gap-10" data-testid="display-authenticated">
          {/* Marque — moitié gauche, ou écran entier quand la sélection est
              vide (arbitrage du propriétaire, 2026-08-11 : pas de repli sur le
              message d'accueil, pas d'interdiction d'enregistrer vide). */}
          <div className="flex-1 min-h-0 flex">
            <CDBrandPanel slogan={snapshot.data?.slogan ?? ''} />
          </div>
          {showcase.length > 0 && (
            <div className="flex-1 min-h-0 flex">
              <ShowcasePanel products={showcase} />
            </div>
          )}
        </div>
      </BrandedLayout>
    );
  }

  // 4c. Interrupteur allumé — l'écran retrouve son comportement d'avant :
  //     pickup queue + featured "now serving" card.
  const ordersList = orders ?? [];
  const current = ordersList[0] ?? null;
  const tail = ordersList.slice(1);

  return (
    <BrandedLayout
      footer={
        <span>
          {ordersList.length === 0
            ? idleFooter
            : `${ordersList.length} order${ordersList.length === 1 ? '' : 's'} active`}
        </span>
      }
    >
      <div
        className="h-full flex gap-8"
        data-testid="display-authenticated"
      >
        {/* Brand moment — logo + slogan (left). */}
        <div className="flex-1 min-h-0 flex">
          <CDBrandPanel slogan={snapshot.data?.slogan ?? ''} />
        </div>
        {/* Order queue + featured card (right). */}
        <div className="flex-1 min-h-0 flex flex-col gap-8">
          <CurrentOrderCard order={current} />
          <div className="flex-1 min-h-0">
            <OrderQueueTicker orders={tail} readyOrders={mergedReadyOrders} />
          </div>
        </div>
      </div>
    </BrandedLayout>
  );
}
