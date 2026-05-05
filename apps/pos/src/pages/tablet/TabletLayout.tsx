import type { JSX } from 'react';
import { Navigate, Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export default function TabletLayout(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const canAccessTablet =
    user?.role_code === 'waiter' || permissions.includes('sales.create');
  if (!canAccessTablet) return <Navigate to="/pos" replace />;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-bg-base">
      <header className="h-14 px-4 border-b border-border-subtle flex items-center justify-between bg-bg-elevated shrink-0">
        <span className="font-serif text-xl">Tablet — {user?.full_name ?? 'Waiter'}</span>
      </header>

      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>

      <nav className="h-14 border-t border-border-subtle bg-bg-elevated flex shrink-0">
        <NavLink
          to="/tablet/order"
          className={({ isActive }) =>
            `flex-1 flex items-center justify-center text-sm font-semibold uppercase tracking-widest ${
              isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary'
            }`
          }
        >
          Order
        </NavLink>
        <NavLink
          to="/tablet/orders"
          className={({ isActive }) =>
            `flex-1 flex items-center justify-center text-sm font-semibold uppercase tracking-widest ${
              isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary'
            }`
          }
        >
          Orders
        </NavLink>
      </nav>
    </div>
  );
}
