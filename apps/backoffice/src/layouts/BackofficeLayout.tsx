// apps/backoffice/src/layouts/BackofficeLayout.tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Users, Building2,
  Calculator, BarChart3, Settings, LogOut,
  type LucideIcon,
} from 'lucide-react';
import { Button, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/backoffice',            label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/backoffice/products',   label: 'Products',   icon: Package },
  { to: '/backoffice/inventory',  label: 'Inventory',  icon: Boxes },
  { to: '/backoffice/purchasing', label: 'Purchasing', icon: ShoppingCart },
  { to: '/backoffice/customers',  label: 'Customers',  icon: Users },
  { to: '/backoffice/b2b',        label: 'B2B',        icon: Building2 },
  { to: '/backoffice/accounting', label: 'Accounting', icon: Calculator },
  { to: '/backoffice/reports',    label: 'Reports',    icon: BarChart3 },
  { to: '/backoffice/settings',   label: 'Settings',   icon: Settings },
];

export function BackofficeLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="h-screen flex bg-bg-base text-text-primary">
      <aside className="w-56 bg-bg-elevated border-r border-border-subtle flex flex-col">
        <div className="px-4 py-4 border-b border-border-subtle">
          <div className="font-serif text-lg">The Breakery</div>
          <div className="text-xs text-text-secondary uppercase tracking-widest">Backoffice</div>
        </div>
        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                {...(n.end === true ? { end: true } : {})}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-4 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-gold-soft text-gold border-r-2 border-gold'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {n.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border-subtle text-xs text-text-secondary">
          <div className="text-text-primary font-semibold">{user?.full_name}</div>
          <div>{user?.role_code}</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 px-6 flex items-center justify-end border-b border-border-subtle bg-bg-elevated">
          <Button variant="ghost" size="sm" onClick={() => { void handleLogout(); }}>
            <LogOut className="h-4 w-4 mr-2" aria-hidden /> Logout
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
