// apps/pos/src/pages/Pos.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LogOut, Settings, History } from 'lucide-react';
import { Button, CustomerSearchModal } from '@breakery/ui';
import { CategorySidebar } from '@/features/products/CategorySidebar';
import { ProductTapHandler } from '@/features/products/ProductTapHandler';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';
import { OpenShiftModal } from '@/features/shift/OpenShiftModal';
import { PaymentTerminal } from '@/features/payment/PaymentTerminal';
import { OrderHistoryPanel } from '@/features/order-history/OrderHistoryPanel';
import { useAuthStore } from '@/stores/authStore';
import { useCurrentShift } from '@/features/shift/hooks/useShift';
import { useCartStore } from '@/stores/cartStore';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@breakery/domain';

export default function PosPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [selectedSlug, setSelectedSlug] = useState<string | null>('favorites');
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: currentShift, isLoading: shiftLoading } = useCurrentShift();
  const needsShift = !shiftLoading && !currentShift;

  const attachCustomer = useCartStore((s) => s.attachCustomer);
  const detachCustomer = useCartStore((s) => s.detachCustomer);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function searchCustomers(query: string): Promise<Customer[]> {
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
    })) as unknown as Customer[];
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
      <header className="h-12 px-4 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-3">
          <span className="font-serif text-lg">The Breakery</span>
          <span className="text-text-secondary text-xs uppercase tracking-widest">POS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">Server: <span className="text-text-primary font-semibold">{user?.full_name}</span></span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Order history"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Settings"><Settings className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" aria-label="Logout" onClick={() => { void handleLogout(); }}><LogOut className="h-5 w-5" /></Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <CategorySidebar selectedSlug={selectedSlug} onSelect={setSelectedSlug} />
        <main className="flex-1 flex flex-col">
          <div className="h-12 px-6 flex items-center border-b border-border-subtle">
            <h1 className="text-text-secondary text-sm uppercase tracking-widest">
              {selectedSlug === 'favorites' ? 'Favorites' : selectedSlug ?? 'All'}
            </h1>
          </div>
          <ProductTapHandler selectedSlug={selectedSlug} />
        </main>
        <ActiveOrderPanel
          onOpenCustomerSearch={() => setCustomerSearchOpen(true)}
          onDetachCustomer={handleDetachCustomer}
        />
      </div>

      <OpenShiftModal open={needsShift} />
      <PaymentTerminal />
      <OrderHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <CustomerSearchModal
        open={customerSearchOpen}
        onClose={() => setCustomerSearchOpen(false)}
        onSelect={(customer) => { attachCustomer(customer); setCustomerSearchOpen(false); }}
        searchFn={searchCustomers}
        createFn={createCustomer}
      />
    </div>
  );
}
