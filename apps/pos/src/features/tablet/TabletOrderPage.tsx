// apps/pos/src/features/tablet/TabletOrderPage.tsx
//
// Session 14 / Phase 3.C — Tablet (waiter) order entry page rewrite.
//
// Visual refs:
//   - docs/Design/backoffice/plan de table.jpg (sectioned floor plan)
//   - docs/Design/caissapp/40-floor-plan-no-selection.jpg (floor preview)
//   - docs/Design/caissapp/41-floor-plan-table-t12-selected.jpg
//
// This is the feature-level surface for the waiter tablet's order-entry
// flow. It composes:
//   - A tactile header with: back-to-floor-plan affordance, the active
//     table chip, dine-in / take-out toggle, and live cart total.
//   - The shared `TabletMenuView` (category sidebar + product grid) on
//     the left and `TabletCartPanel` on the right.
//   - A persistent "Send to Kitchen" CTA in the cart panel which goes
//     through `useCreateTabletOrder` → `create_tablet_order` RPC.
//   - An optional `<FloorPlanView>` overlay shown when the waiter taps
//     the table chip (mode === 'floor-plan').
//
// Touch-spacing strategy:
//   - Header: h ≥ touch-comfy (56px), gap-4, tap-targets ≥ 44px (min-h-11).
//   - Order-type tabs: each pill h-11 (44px) min, px-5.
//   - Floor plan overlay: full-bleed, no modal chrome — waiter swipes back.
//   - Generous gaps between sections (gap-6 / gap-8 in canvas).
//
// IO contract:
//   - Reads tables via `useRestaurantTables` and occupancy via
//     `useTableOccupancy` (both StrictMode-safe with per-mount channel
//     names — see CLAUDE.md note).
//   - Cart state lives in `tabletCartStore` (zustand).
//   - Order writes go through `useCreateTabletOrder` which wraps the
//     `create_tablet_order` RPC with `buildSubmitPayload` from
//     `@breakery/domain` — never raw inserts. After success, the cart
//     is cleared and the host typically navigates to `/tablet/orders`.

import { useState, useCallback, useRef, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, MapPin } from 'lucide-react';
import type { RestaurantTable } from '@breakery/domain';
import { Button, Currency } from '@breakery/ui';
import { calculatePreview } from '@breakery/domain';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';
import { useRestaurantTables } from '@/features/tables/hooks/useRestaurantTables';
import { useTableOccupancy } from '@/features/tables/hooks/useTableOccupancy';
import { TabletMenuView } from './components/TabletMenuView';
import { TabletCartPanel } from './components/TabletCartPanel';
import { OfflineBanner } from './components/OfflineBanner';
import { OrderTypeToggle } from './components/OrderTypeToggle';
import { useTabletOffline } from './hooks/useTabletOffline';
import { useCreateTabletOrder } from './hooks/useCreateTabletOrder';
import { FloorPlanView } from './FloorPlanView';

type ViewMode = 'menu' | 'floor-plan';

export interface TabletOrderPageProps {
  /**
   * Optional injected dependencies — used by tests to bypass network IO.
   * Production callers can omit these entirely.
   */
  tablesOverride?: RestaurantTable[];
  occupancyOverride?: Record<string, boolean>;
  /** Where to navigate after a successful "send to kitchen". */
  redirectAfterSend?: string;
  /** Optional override for the create-order mutation (test seam). */
  onSendOverride?: (waiterId: string) => Promise<void>;
}

export function TabletOrderPage({
  tablesOverride,
  occupancyOverride,
  redirectAfterSend = '/tablet/orders',
  onSendOverride,
}: TabletOrderPageProps = {}): JSX.Element {
  const [view, setView] = useState<ViewMode>('menu');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const items = useTabletCartStore((s) => s.items);
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  const setTableNumber = useTabletCartStore((s) => s.setTableNumber);
  const orderType = useTabletCartStore((s) => s.orderType);
  const setOrderType = useTabletCartStore((s) => s.setOrderType);
  const notes = useTabletCartStore((s) => s.notes);
  const clearCart = useTabletCartStore((s) => s.clearCart);
  const userId = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();

  const tablesQuery = useRestaurantTables();
  const liveOccupancy = useTableOccupancy();
  const tables = tablesOverride ?? tablesQuery.data ?? [];
  const occupancy = occupancyOverride ?? liveOccupancy;

  const { isOnline, lastSync } = useTabletOffline();
  const mutation = useCreateTabletOrder();
  const clientUuidRef = useRef<string>(crypto.randomUUID());

  const preview = calculatePreview({ items, tableNumber, orderType });
  const isEmpty = items.length === 0;
  const isSending = mutation.isPending;

  const handleTableSelect = useCallback(
    (name: string) => {
      setTableNumber(name);
      setOrderType('dine_in');
      setView('menu');
    },
    [setTableNumber, setOrderType],
  );

  const handleSend = useCallback(async () => {
    if (!userId || isEmpty) return;
    try {
      if (onSendOverride) {
        await onSendOverride(userId);
      } else {
        await mutation.mutateAsync({
          cart: { items, tableNumber, orderType, notes },
          waiterId: userId,
          clientUuid: clientUuidRef.current,
        });
      }
      toast.success('Order sent to kitchen');
      clearCart();
      clientUuidRef.current = crypto.randomUUID();
      void navigate(redirectAfterSend);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send order';
      toast.error(message);
    }
  }, [
    userId,
    isEmpty,
    onSendOverride,
    mutation,
    items,
    tableNumber,
    orderType,
    notes,
    clearCart,
    navigate,
    redirectAfterSend,
  ]);

  // ── Floor plan overlay ──────────────────────────────────────────────
  if (view === 'floor-plan') {
    return (
      <div className="flex flex-col h-full">
        <OfflineBanner isOnline={isOnline} lastSync={lastSync} />
        <div className="px-6 py-3 border-b border-border-subtle bg-bg-elevated flex items-center gap-4">
          <Button
            variant="ghost"
            size="md"
            className="min-h-11 gap-2"
            onClick={() => setView('menu')}
            aria-label="Back to menu"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
            Back
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          <FloorPlanView
            tables={tables}
            occupancy={occupancy}
            selectedTable={tableNumber}
            onTableSelect={handleTableSelect}
          />
        </div>
      </div>
    );
  }

  // ── Menu view ───────────────────────────────────────────────────────
  const toolbar = (
    <div
      className="px-6 py-4 flex items-center gap-4 border-b border-border-subtle bg-bg-elevated"
      data-testid="tablet-order-toolbar"
    >
      <Button
        variant="secondary"
        size="md"
        className="min-h-11 gap-2"
        onClick={() => setView('floor-plan')}
        disabled={!isOnline}
        data-testid="tablet-order-pick-table"
      >
        <MapPin className="h-5 w-5 shrink-0" aria-hidden />
        {tableNumber ? `Table ${tableNumber}` : 'Pick a table'}
      </Button>

      <OrderTypeToggle value={orderType} onChange={setOrderType} />

      <div className="ml-auto flex items-center gap-3" aria-label="Cart total">
        <span className="text-xs uppercase tracking-widest text-text-muted">Total</span>
        <Currency amount={preview.items_total} emphasis="gold" className="text-xl" />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full" data-testid="tablet-order-page">
      <OfflineBanner isOnline={isOnline} lastSync={lastSync} />
      <div className="flex flex-1 overflow-hidden">
        <TabletMenuView
          selectedSlug={selectedSlug}
          onSelectCategory={setSelectedSlug}
          toolbar={toolbar}
        />
        <div className="w-[320px] border-l border-border-subtle flex flex-col bg-bg-elevated">
          <div className="flex-1 overflow-hidden">
            <TabletCartPanel />
          </div>
          <div className="p-4 border-t border-border-subtle">
            <Button
              variant="primary"
              size="lg"
              className="w-full min-h-11"
              disabled={isEmpty || isSending}
              onClick={() => {
                void handleSend();
              }}
              data-testid="tablet-order-send"
            >
              {isSending ? 'Sending…' : 'Send to Kitchen'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TabletOrderPage;
