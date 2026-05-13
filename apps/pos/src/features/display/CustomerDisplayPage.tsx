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
// MVP scope (per D-4C-6) : branded layout + queue ticker + featured card.
// The full live cart mirror (`CDActiveCartView`) lands in Phase 5.A with
// the LAN BroadcastChannel port.

import { useEffect, useMemo, useState } from 'react';

import { readKioskPairing } from '@/lib/kioskAuth';

import { BrandedLayout } from './components/BrandedLayout';
import { CurrentOrderCard } from './components/CurrentOrderCard';
import { OrderQueueTicker } from './components/OrderQueueTicker';
import { PairDevicePrompt } from './components/PairDevicePrompt';
import { useDisplayOrders } from './hooks/useDisplayOrders';
import { useDisplayRealtime } from './hooks/useDisplayRealtime';
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
        className="h-full flex flex-col gap-8"
        data-testid="display-authenticated"
      >
        <CurrentOrderCard order={current} />
        <div className="flex-1 min-h-0">
          <OrderQueueTicker orders={tail} />
        </div>
      </div>
    </BrandedLayout>
  );
}
