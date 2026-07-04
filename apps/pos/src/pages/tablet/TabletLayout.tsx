import type { JSX } from 'react';
import { Navigate, Outlet, NavLink } from 'react-router-dom';
import { MapPin, Wifi, WifiOff } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { useTabletOffline } from '@/features/tablet/hooks/useTabletOffline';
import { useMyTabletOrders } from '@/features/tablet/hooks/useMyTabletOrders';
import { useLanHeartbeat } from '@/features/lan/hooks/useLanHeartbeat';

export default function TabletLayout(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  // Session 59 (21 D1.1) — heartbeat so BO "LAN Devices" reflects this tablet
  // as online. No-ops until an operator sets a device code in POS Settings →
  // Devices (mesh hub/client stay unmounted — decision 2 pending).
  const deviceCode = usePosSettingsStore((s) => s.deviceCode);
  useLanHeartbeat({ deviceCode, deviceType: 'tablet' });

  // LOT 6 (audit 2026-06-25) — header context: active table, a persistent
  // online/offline pill, and a live order count. These hooks are cheap (cached
  // queries / interval ping) and the data is already fetched elsewhere.
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  const { isOnline } = useTabletOffline();
  const { data: orders = [] } = useMyTabletOrders();
  const orderCount = orders.length;

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const canAccessTablet =
    user?.role_code === 'waiter' || permissions.includes('sales.create');
  if (!canAccessTablet) return <Navigate to="/pos" replace />;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-bg-base">
      <header className="h-14 px-4 border-b border-border-subtle flex items-center justify-between gap-3 bg-bg-elevated shrink-0">
        <span className="font-serif text-xl truncate">{user?.full_name ?? 'Waiter'}</span>

        <div className="flex items-center gap-2">
          {/* Active table */}
          <span
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-bg-input text-sm text-text-primary"
            data-testid="tablet-active-table"
          >
            <MapPin className="h-4 w-4 text-gold shrink-0" aria-hidden />
            {tableNumber ? `Table ${tableNumber}` : 'No table'}
          </span>

          {/* Persistent online/offline pill */}
          <span
            data-testid="tablet-connection-pill"
            className={
              isOnline
                ? 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-success-soft text-success text-xs font-semibold uppercase tracking-wide'
                : 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-warning-soft text-warning text-xs font-semibold uppercase tracking-wide'
            }
            role="status"
            aria-live="polite"
          >
            {isOnline ? (
              <Wifi className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
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
            `flex-1 flex items-center justify-center gap-2 text-sm font-semibold uppercase tracking-widest ${
              isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary'
            }`
          }
        >
          Orders
          {orderCount > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gold text-bg-base text-[10px] font-bold"
              aria-label={`${orderCount} order${orderCount === 1 ? '' : 's'}`}
            >
              {orderCount}
            </span>
          )}
        </NavLink>
      </nav>
    </div>
  );
}
