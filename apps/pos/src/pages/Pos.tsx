// apps/pos/src/pages/Pos.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import { Button } from '@breakery/ui';
import { CategorySidebar } from '@/features/products/CategorySidebar';
import { ProductTapHandler } from '@/features/products/ProductTapHandler';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';
import { OpenShiftModal } from '@/features/shift/OpenShiftModal';
import { PaymentTerminal } from '@/features/payment/PaymentTerminal';
import { useAuthStore } from '@/stores/authStore';
import { useCurrentShift } from '@/features/shift/hooks/useShift';

export default function PosPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [selectedSlug, setSelectedSlug] = useState<string | null>('favorites');

  const { data: currentShift, isLoading: shiftLoading } = useCurrentShift();
  const needsShift = !shiftLoading && !currentShift;

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
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
        <ActiveOrderPanel />
      </div>

      <OpenShiftModal open={needsShift} />
      <PaymentTerminal />
    </div>
  );
}
