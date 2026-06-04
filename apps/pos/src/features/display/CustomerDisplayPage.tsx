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

import { readKioskPairing } from '@/lib/kioskAuth';

import { BrandedLayout } from './components/BrandedLayout';
import { CurrentOrderCard } from './components/CurrentOrderCard';
import { OrderQueueTicker } from './components/OrderQueueTicker';
import { PairDevicePrompt } from './components/PairDevicePrompt';
import { CDActiveCartView } from './CDActiveCartView';
import { useDisplayOrders } from './hooks/useDisplayOrders';
import { useDisplayRealtime } from './hooks/useDisplayRealtime';
import { useCartBroadcastReceiver } from './hooks/useCartBroadcastReceiver';
import { useKioskAuth } from './hooks/useKioskAuth';

export default function CustomerDisplayPage() {
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

  // Stable screenId for realtime channel naming. When unpaired, we still
  // mount the hook with a placeholder — but the query is disabled below.
  const screenId = useMemo(() => pairedCode ?? 'unpaired', [pairedCode]);

  // Wire realtime updates (mounted unconditionally so the channel-unique
  // pattern is exercised on every load) and order fetch (disabled until
  // auth + pairing succeed).
  useDisplayRealtime(screenId);
  const ordersEnabled = auth.status === 'authenticated' && pairedCode !== null;
  const { data: orders } = useDisplayOrders(ordersEnabled);

  // Live cart mirror from the POS side (F-007). Safe to read on every render —
  // the view renders its own welcome empty-state when the message is null.
  const cartMessage = useCartBroadcastReceiver();

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

  // 4. Happy path — render queue + current order.
  const ordersList = orders ?? [];
  const current = ordersList[0] ?? null;
  const tail = ordersList.slice(1);

  return (
    <BrandedLayout
      footer={
        <span>
          {ordersList.length === 0
            ? 'Open daily · 07:00 — 21:00'
            : `${ordersList.length} order${ordersList.length === 1 ? '' : 's'} active`}
        </span>
      }
    >
      <div
        className="h-full flex gap-8"
        data-testid="display-authenticated"
      >
        {/* Live cart mirror (left) — reflects the active POS cart (F-007). */}
        <div className="flex-1 min-h-0 flex">
          <CDActiveCartView message={cartMessage} />
        </div>
        {/* Order queue + featured card (right). */}
        <div className="flex-1 min-h-0 flex flex-col gap-8">
          <CurrentOrderCard order={current} />
          <div className="flex-1 min-h-0">
            <OrderQueueTicker orders={tail} />
          </div>
        </div>
      </div>
    </BrandedLayout>
  );
}
