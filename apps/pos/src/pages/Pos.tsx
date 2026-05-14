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
import { CustomerAttachModal } from '@/features/cart/CustomerAttachModal';
import { OpenShiftModal } from '@/features/shift/OpenShiftModal';
import { ShiftClosedState } from '@/features/shift/ShiftClosedState';
import { PaymentTerminal } from '@/features/payment/PaymentTerminal';
import { OrderHistoryPanel } from '@/features/order-history/OrderHistoryPanel';
import { useAuthStore } from '@/stores/authStore';
import { useCurrentShift } from '@/features/shift/hooks/useShift';
import { useCartStore } from '@/stores/cartStore';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@breakery/domain';
import type { CustomerWithCategory } from '@/stores/cartStore';

export default function PosPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [selectedSlug, setSelectedSlug] = useState<string | null>('favorites');
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const attachCustomer = useCartStore((s) => s.attachCustomer);
  const detachCustomer = useCartStore((s) => s.detachCustomer);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function searchCustomers(query: string): Promise<CustomerWithCategory[]> {
    if (query.trim().length < 2) return [];
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone, email, customer_type, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at, category_id, category:customer_categories(id, name, slug, color, icon, price_modifier_type, discount_percentage, loyalty_enabled, points_multiplier, is_default)')
      .or(`phone.ilike.%${query}%,name.ilike.%${query}%`)
      .is('deleted_at', null)
      .limit(10);
    return (data ?? []).map((row) => ({
      ...row,
      category: row.category ?? null,
    })) as unknown as CustomerWithCategory[];
  }

  async function createCustomer(input: { name: string; phone: string; email?: string }): Promise<Customer> {
    const defaultCat = await supabase
      .from('customer_categories')
      .select('id')
      .eq('is_default', true)
      .is('deleted_at', null)
      .limit(1)
      .single();
    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        customer_type: 'retail',
        ...(defaultCat.data?.id ? { category_id: defaultCat.data.id } : {}),
      })
      .select('id, name, phone, email, customer_type, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at')
      .single();
    if (error) throw error;
    return data as Customer;
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

      <div className="flex-1 flex overflow-hidden">
        <CategoryNav
          selectedSlug={selectedSlug}
          onSelect={setSelectedSlug}
          onOpenSettings={() => navigate('/pos/settings')}
        />
        <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden">
          <ProductTapHandler selectedSlug={selectedSlug} />
        </main>
        <ActiveOrderPanel
          onOpenCustomerSearch={() => setCustomerSearchOpen(true)}
          onDetachCustomer={handleDetachCustomer}
        />
      </div>

      <SideMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        userName={user?.full_name ?? null}
        userRole={user?.role_code?.toUpperCase() ?? null}
        userInitial={user?.full_name?.charAt(0) ?? null}
        onOpenHistory={() => setHistoryOpen(true)}
        onLogout={() => { void handleLogout(); }}
      />

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
      <PaymentTerminal />
      <OrderHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <CustomerAttachModal
        open={customerSearchOpen}
        onClose={() => setCustomerSearchOpen(false)}
        onSelect={(customer) => { attachCustomer(customer); setCustomerSearchOpen(false); }}
        searchFn={searchCustomers}
        createFn={createCustomer}
      />
    </div>
  );
}
