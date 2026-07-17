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

import { useEffect, useMemo, useState } from 'react';

import type { CartItem } from '@breakery/domain';

import { readKioskPairing } from '@/lib/kioskAuth';

import { BrandedLayout } from './components/BrandedLayout';
import { CDBrandPanel } from './components/CDBrandPanel';
import { CDPaymentPanel } from './components/CDPaymentPanel';
import { CurrentOrderCard } from './components/CurrentOrderCard';
import { OrderQueueTicker } from './components/OrderQueueTicker';
import { PairDevicePrompt } from './components/PairDevicePrompt';
import { CustomerDisplayView, type CustomerDisplayLine } from './CustomerDisplayView';
import { useDisplayOrders } from './hooks/useDisplayOrders';
import { useDisplayRealtime } from './hooks/useDisplayRealtime';
import { useReadyOrders } from './hooks/useReadyOrders';
import { useCartBroadcastReceiver } from './hooks/useCartBroadcastReceiver';
import { useKioskAuth } from './hooks/useKioskAuth';
import { useOrgDisplaySettings } from '@/features/settings/hooks/useOrgDisplaySettings';
import { useSettingsRealtime } from '@/features/settings/hooks/useSettingsRealtime';

/** Built-in idle footer used when no custom message is configured. */
const DEFAULT_DISPLAY_FOOTER = 'Open daily · 07:00 — 21:00';

/** Design Wave C — if no cart broadcast lands for this long, the mirror is
 *  considered stale and the display falls back to the idle/pickup-queue view
 *  rather than freezing on a cart the cashier abandoned. Each new broadcast
 *  resets the timer, so an actively-rung cart never trips it. */
const CART_FRESHNESS_MS = 5 * 60 * 1_000;

export default function CustomerDisplayPage() {
  const auth = useKioskAuth();
  // Settings §6.C — push settings propagation for the kiosk surface. The App
  // shell mount is gated on the PIN session, which the display doesn't have;
  // this one re-arms once the kiosk JWT lands (realtime joins with that token).
  useSettingsRealtime(auth.status === 'authenticated');
  // Org-level customer-display copy (S73 Lot 2 — POS Settings → Customer Display).
  const { displayFooterMessage } = useOrgDisplaySettings();
  const idleFooter = displayFooterMessage || DEFAULT_DISPLAY_FOOTER;
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

  // Stable screenId for realtime channel naming. When unpaired, we still
  // mount the hook with a placeholder — but the query is disabled below.
  const screenId = useMemo(() => pairedCode ?? 'unpaired', [pairedCode]);

  // Wire realtime updates (mounted unconditionally so the channel-unique
  // pattern is exercised on every load) and order fetch (disabled until
  // auth + pairing succeed).
  useDisplayRealtime(screenId);
  const ordersEnabled = auth.status === 'authenticated' && pairedCode !== null;
  const { data: orders } = useDisplayOrders(ordersEnabled);
  // Session 59 (16 D1.2) — kitchen-ready feed, independent of payment status.
  const { data: readyOrders } = useReadyOrders(ordersEnabled);

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
          errorHint={
            auth.status === 'pin_fallback'
              ? `Kiosk authentication failed (${auth.error ?? 'unknown'}). Re-enter pairing code.`
              : null
          }
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

  // 4a. Checkout takes the FULL screen (design audit 2026-07-07 B4) — while
  //     a sale is being rung up or just completed, the customer's attention
  //     stays on their own order/total, never on the pickup queue. Split-brand
  //     redesign: brand panel (left) + payment confirmation detail (right).
  if (cartMessage?.type === 'payment_complete') {
    return (
      <BrandedLayout footer={<span>{idleFooter}</span>}>
        <div className="h-full flex gap-10" data-testid="display-authenticated">
          <div className="flex-1 min-h-0 flex">
            <CDBrandPanel />
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
        const adjustment = item.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
        return {
          id: item.id,
          product_id: item.product_id,
          name: item.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: (item.unit_price + adjustment) * item.quantity,
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

  // 4b. Idle — no active cart: pickup queue + featured "now serving" card.
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
          <CDBrandPanel />
        </div>
        {/* Order queue + featured card (right). */}
        <div className="flex-1 min-h-0 flex flex-col gap-8">
          <CurrentOrderCard order={current} />
          <div className="flex-1 min-h-0">
            <OrderQueueTicker orders={tail} readyOrders={readyOrders ?? []} />
          </div>
        </div>
      </div>
    </BrandedLayout>
  );
}
