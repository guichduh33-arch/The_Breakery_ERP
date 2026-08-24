import { useEffect, type JSX } from 'react';
import { Navigate, Outlet, NavLink } from 'react-router-dom';
import { toast } from 'sonner';
import { MapPin, Wifi, WifiOff, TriangleAlert, ClipboardList, History } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { TerminalLockedOverlay } from '@/features/auth/TerminalLockedOverlay';
import { useTabletConnectionState } from '@/features/tablet/hooks/useTabletConnectionState';
import { isInFlight } from '@breakery/domain';
import { useMyTabletOrders } from '@/features/tablet/hooks/useMyTabletOrders';
import { useLanHeartbeat } from '@/features/lan/hooks/useLanHeartbeat';
import { useHubPresence } from '@/features/lan/hooks/useHubPresence';
import { useCloudPing } from '@/features/lan/hooks/useCloudPing';
import { useOfflineReplay } from '@/features/lan/hooks/useOfflineReplay';

function TabletAccessDenied(): JSX.Element {
  useEffect(() => {
    // id fixe : dédoublonne le double-mount de StrictMode en dev.
    toast.error(
      'Tablet ordering needs the waiter role or the sales permission — redirected to the POS.',
      { id: 'tablet-access-denied' },
    );
  }, []);
  return <Navigate to="/pos" replace />;
}

export default function TabletLayout(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  // Session 59 (21 D1.1) — heartbeat so BO "LAN Devices" reflects this tablet
  // as online. No-ops until an operator sets a device code in POS Settings →
  // Devices. Spec 006x lot 1 — also join the LAN hub bus (presence only).
  const deviceCode = usePosSettingsStore((s) => s.deviceCode);
  useLanHeartbeat({ deviceCode, deviceType: 'tablet' });
  useHubPresence({ deviceCode, deviceType: 'tablet' });
  // Spec 006x lot 3 — détection internet down (mode offline du bus LAN).
  useCloudPing();
  // Spec 006x lot 4 — replay des envois tablette hors-ligne au retour cloud.
  useOfflineReplay();

  // LOT 6 (audit 2026-06-25) — header context: active table, a persistent
  // online/offline pill, and a live order count. These hooks are cheap (cached
  // queries / interval ping) and the data is already fetched elsewhere.
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  // Lot D (audit 2026-08-22) — même source que isOfflineMode(), qui décide du
  // chemin d'envoi réel. La pastille montrait auparavant un ping indépendant
  // qui ignorait le hub LAN : elle pouvait annoncer « Offline » pendant que le
  // code partait en ligne, et échouait.
  const connection = useTabletConnectionState();
  const { data: orders = [] } = useMyTabletOrders();
  // Le verrou d'inactivité (IdleTimeoutMount, monté dans App.tsx) et la mort de
  // session (sessionDeathWatch) posent isLocked sur TOUTES les routes. L'écran
  // de verrouillage, lui, n'était rendu que par /pos et les satellites : la
  // tablette passait donc à l'état verrouillé sans jamais l'afficher, et restait
  // pilotable — sur l'appareil justement laissé sans surveillance.
  const isLocked = useAuthStore((s) => s.isLocked);
  // Le badge comptait TOUTES les commandes de l'historique : au bout d'un mois
  // il annonçait plusieurs centaines, et un compteur qui n'indique rien
  // d'actionnable cesse d'être regardé. On ne compte que ce qui est en vol.
  const orderCount = orders.filter((o) => isInFlight(o.status)).length;

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const canAccessTablet =
    user?.role_code === 'waiter' || permissions.includes('sales.create');
  // Critique run 4 lot 4 (clarify) — l'éjection était silencieuse : l'écran
  // changeait sans un mot, et l'utilisateur ne savait pas pourquoi ni quoi
  // demander. Le toast nomme la cause et la destination.
  if (!canAccessTablet) return <TabletAccessDenied />;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-bg-base">
      <header className="h-14 px-4 border-b border-border-subtle flex items-center justify-between gap-3 bg-bg-elevated shrink-0">
        {/* Audit 2026-08-24 (a11y P2) — h1 : la surface n'avait aucun titre de
            page pour la navigation par titres. */}
        <h1 className="font-semibold text-xl truncate">{user?.full_name ?? 'Waiter'}</h1>

        <div className="flex items-center gap-2">
          {/* Active table */}
          <span
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-bg-input text-sm text-text-primary"
            data-testid="tablet-active-table"
          >
            <MapPin className="h-4 w-4 text-gold shrink-0" aria-hidden />
            {tableNumber ? `Table ${tableNumber}` : 'No table'}
          </span>

          {/* Pastille d'état, trois valeurs — voir useTabletConnectionState.
              « Offline » veut dire « la commande part quand même, par le bus » ;
              « No network » veut dire « rien ne part ». Les confondre envoyait
              la serveuse continuer alors que plus rien n'aboutissait. */}
          <span
            data-testid="tablet-connection-pill"
            data-connection-state={connection.state}
            className={
              connection.state === 'online'
                ? 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-success-soft text-success text-xs font-semibold uppercase tracking-wide'
                : connection.state === 'offline_bus'
                  ? 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-warning-soft text-warning text-xs font-semibold uppercase tracking-wide'
                  : 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-danger-soft text-danger text-xs font-semibold uppercase tracking-wide'
            }
            role="status"
            aria-live="polite"
          >
            {connection.state === 'online' ? (
              <Wifi className="h-4 w-4 shrink-0" aria-hidden />
            ) : connection.state === 'offline_bus' ? (
              <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {connection.state === 'online'
              ? 'Online'
              : connection.state === 'offline_bus'
                ? 'Offline'
                : 'No network'}
          </span>
        </div>
      </header>

      {/* main : landmark manquant — la navigation par landmarks était
          impossible sur /tablet (a11y P2). */}
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Audit 2026-08-24 (responsive P1) — pb-safe-area : sur l'APK Capacitor
          la nav basse était collée sous la barre gestuelle Android. */}
      <nav className="min-h-14 border-t border-border-subtle bg-bg-elevated flex shrink-0 pb-safe-bottom">
        <NavLink
          to="/tablet/order"
          className={({ isActive }) =>
            `flex-1 flex items-center justify-center gap-2 text-sm font-semibold uppercase tracking-widest ${
              isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary'
            }`
          }
        >
          <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
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
          <History className="h-4 w-4 shrink-0" aria-hidden />
          Orders
          {orderCount > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gold text-gold-fg text-xs font-bold"
              aria-label={`${orderCount} order${orderCount === 1 ? '' : 's'}`}
            >
              {orderCount}
            </span>
          )}
        </NavLink>
      </nav>

      {isLocked && <TerminalLockedOverlay />}
    </div>
  );
}
