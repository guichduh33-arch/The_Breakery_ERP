// apps/pos/src/pages/Pos.tsx
//
// Session 14 — Phase 2.A — POS shell.
//
// Refactor highlights (vs. Session 13 baseline) :
//   - Top-left now renders the canonical <BrandMark size="md" />
//     replacing the prior "The Breakery" text wordmark (per D7.1).
//   - A hamburger icon (Menu) at the LEFT of the top bar opens the new
//     <SideMenuDrawer> with master nav links (history, reports, debts,
//     customers, live sessions, settings, lock terminal, sign out).
//   - The right-side header still surfaces the cashier name + a quick
//     History shortcut, but the legacy Settings / Logout icons moved into
//     the drawer to match ref 87 (single hamburger entry point).
//   - The middle column now consumes the new <CategoryNav> (vertical
//     uppercase labels, gold accent for the active row) and ProductGrid
//     renders its own title + search bar (cf. ref 01).
//
// Cart panel / payment terminal / shift / customer-search modal are
// unchanged — pos-cart / pos-flow own those surfaces in Phase 2.B/C.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Menu, History } from 'lucide-react';
import {
  BrandMark,
  Button,
} from '@breakery/ui';
import { CategoryNav } from '@/features/products/CategoryNav';
import { ProductTapHandler } from '@/features/products/ProductTapHandler';
import { SideMenuDrawer } from '@/features/nav/SideMenuDrawer';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';
import { BottomActionBar } from '@/features/cart/BottomActionBar';
import { CustomerAttachModal } from '@/features/cart/CustomerAttachModal';
import { OpenShiftModal } from '@/features/shift/OpenShiftModal';
import { CloseShiftModal } from '@/features/shift/components/CloseShiftModal';
import { useShiftCloseSummary } from '@/features/shift/hooks/useShiftCloseSummary';
import { ShiftClosedState } from '@/features/shift/ShiftClosedState';
import { PaymentTerminal } from '@/features/payment/PaymentTerminal';
import { OrderHistoryPanel } from '@/features/order-history/OrderHistoryPanel';
import { LiveSessionsModal } from '@/features/shift/LiveSessionsModal';
import { ChangePinModal } from '@/features/auth/ChangePinModal';
import { TerminalLockedOverlay } from '@/features/auth/TerminalLockedOverlay';
import { useAuthStore } from '@/stores/authStore';
import { useCurrentShift } from '@/features/shift/hooks/useShift';
import { useCartStore } from '@/stores/cartStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { useLanHeartbeat } from '@/features/lan/hooks/useLanHeartbeat';
import { useHubPresence } from '@/features/lan/hooks/useHubPresence';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@breakery/domain';
import type { CustomerWithCategory } from '@/stores/cartStore';

export default function PosPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isLocked = useAuthStore((s) => s.isLocked);
  const lock = useAuthStore((s) => s.lock);
  const [selectedSlug, setSelectedSlug] = useState<string | null>('favorites');
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [liveSessionsOpen, setLiveSessionsOpen] = useState(false);
  // Session 19 / Phase 3.C — self-change PIN modal (greenfield).
  const [changePinOpen, setChangePinOpen] = useState(false);
  const currentUserId = user?.id ?? null;

  const { data: currentShift, isLoading: shiftLoading } = useCurrentShift();
  const needsShift = !shiftLoading && !currentShift;
  // Two-stage shift gate (Session 14 / Phase 2.C) :
  //   1. ShiftClosedState alert (ref 10) — shown when needsShift is true.
  //   2. OpenShiftModal (refs 11-13) — opens when cashier clicks "Open a Shift".
  // The alert can be dismissed (Cancel) without opening a shift ; the user
  // then re-triggers it via any cart action requiring a shift.
  const [openShiftOpen, setOpenShiftOpen] = useState(false);
  const [shiftAlertDismissed, setShiftAlertDismissed] = useState(false);
  const shiftAlertOpen = needsShift && !openShiftOpen && !shiftAlertDismissed;

  // POS audit 2026-06-12 lot 3 — close-shift flow. The summary query only
  // runs while the modal is requested so the preview is fresh at open time;
  // close_shift_v2 recomputes server-side regardless.
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const { data: closeSummary } = useShiftCloseSummary(
    closeShiftOpen ? (currentShift?.id ?? null) : null,
  );

  const attachCustomer = useCartStore((s) => s.attachCustomer);
  const detachCustomer = useCartStore((s) => s.detachCustomer);

  // Session 59 (21 D1.1) — emit a heartbeat so BO "LAN Devices" reflects this
  // terminal as online. No-ops until an operator sets a device code in
  // Settings → Devices. Spec 006x lot 1 — also join the LAN hub bus
  // (presence only; cloud heartbeat stays the writer until lot 2).
  const deviceCode = usePosSettingsStore((s) => s.deviceCode);
  useLanHeartbeat({ deviceCode, deviceType: 'pos' });
  useHubPresence({ deviceCode, deviceType: 'pos' });

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  // S37 C5 (SEC-03) — search/create go through the SECURITY DEFINER customer
  // RPCs v3 so they survive the customers.read SELECT gate (PII cutover).
  // S50 W1.4 — bumped v2 → v3 (dual gate: customers.read OR pos.sale.create).
  async function searchCustomers(query: string): Promise<CustomerWithCategory[]> {
    if (query.trim().length < 2) return [];
    const { data } = await supabase.rpc('search_customers_v3', {
      p_query: query,
      p_limit: 10,
    });
    return (data ?? []).map((row) => ({
      ...row,
      category: row.category ?? null,
    })) as unknown as CustomerWithCategory[];
  }

  async function createCustomer(input: { name: string; phone: string; email?: string }): Promise<Customer> {
    // Default category is assigned server-side by create_customer_v2 (_019).
    const { data, error } = await supabase.rpc('create_customer_v2', {
      p_name: input.name,
      p_phone: input.phone,
      ...(input.email ? { p_email: input.email } : {}),
    });
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) throw new Error('create_customer_v2 returned no row');
    return row as unknown as Customer;
  }

  function handleDetachCustomer() {
    detachCustomer();
    toast.info('Pricing not auto-recomputed. Re-add items to apply new pricing.');
  }

  return (
    <div className="h-screen flex flex-col bg-bg-base text-text-primary">
      <header className="h-14 px-4 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            data-testid="pos-menu-trigger"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <BrandMark size="md" />
          <span className="font-display text-sm text-text-muted uppercase tracking-widest">
            POS
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">
            Server:{' '}
            <span className="text-text-primary font-semibold">{user?.full_name}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Order history"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Below md (waiter phone, one-hand) the 3-column desktop layout stacks:
          category strip on top, grid, then the order panel — no horizontal
          scroll at 390px (pos-design-craft P0, 2026-07-06). */}
      <div className="flex-1 min-h-0 flex overflow-hidden max-md:flex-col">
        <CategoryNav
          selectedSlug={selectedSlug}
          onSelect={setSelectedSlug}
          onOpenSettings={() => navigate('/pos/settings')}
        />
        <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden">
          <ProductTapHandler selectedSlug={selectedSlug} />
        </main>
        <ActiveOrderPanel onDetachCustomer={handleDetachCustomer} />
      </div>

      {/* Global action bar — all order actions live here (full width). */}
      <BottomActionBar onOpenCustomerSearch={() => setCustomerSearchOpen(true)} />

      <SideMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        userName={user?.full_name ?? null}
        userRole={user?.role_code?.toUpperCase() ?? null}
        userInitial={user?.full_name?.charAt(0) ?? null}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenLiveSessions={() => setLiveSessionsOpen(true)}
        {...(currentShift ? { onCloseShift: () => setCloseShiftOpen(true) } : {})}
        sessionId={currentShift?.id ?? null}
        onLockTerminal={() => { setMenuOpen(false); lock(); }}
        {...(currentUserId ? { onChangePin: () => setChangePinOpen(true) } : {})}
        onLogout={() => { void handleLogout(); }}
      />
      <LiveSessionsModal
        open={liveSessionsOpen}
        onClose={() => setLiveSessionsOpen(false)}
      />
      {currentUserId && (
        <ChangePinModal
          open={changePinOpen}
          onClose={() => setChangePinOpen(false)}
          userId={currentUserId}
        />
      )}

      <ShiftClosedState
        open={shiftAlertOpen}
        onCancel={() => setShiftAlertDismissed(true)}
        onRecover={() => toast.info('Recover shift not implemented yet')}
        onOpenShift={() => { setShiftAlertDismissed(false); setOpenShiftOpen(true); }}
      />
      <OpenShiftModal
        open={needsShift && openShiftOpen}
        onClose={() => setOpenShiftOpen(false)}
      />
      {currentShift && closeShiftOpen && closeSummary && (
        <CloseShiftModal
          open
          sessionId={currentShift.id}
          expectedCash={closeSummary.expectedCash}
          thresholdAbs={closeSummary.thresholdAbs}
          thresholdPct={closeSummary.thresholdPct}
          pinThresholdAbs={closeSummary.pinThresholdAbs}
          pinThresholdPct={closeSummary.pinThresholdPct}
          onClose={() => setCloseShiftOpen(false)}
        />
      )}
      <PaymentTerminal />
      <OrderHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <CustomerAttachModal
        open={customerSearchOpen}
        onClose={() => setCustomerSearchOpen(false)}
        onSelect={(customer) => { attachCustomer(customer); setCustomerSearchOpen(false); }}
        searchFn={searchCustomers}
        createFn={createCustomer}
      />

      {isLocked && <TerminalLockedOverlay />}
    </div>
  );
}
