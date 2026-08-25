import { useEffect, type JSX } from 'react';
import { Navigate, Outlet, NavLink } from 'react-router-dom';
import { toast } from 'sonner';
import { MapPin, Wifi, ClipboardList, History } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { TerminalLockedOverlay } from '@/features/auth/TerminalLockedOverlay';
import { useTabletConnectionState } from '@/features/tablet/hooks/useTabletConnectionState';
import { OfflineBanner } from '@/features/tablet/components/OfflineBanner';
import { isInFlight } from '@breakery/domain';
import { useMyTabletOrders } from '@/features/tablet/hooks/useMyTabletOrders';
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

  // Heartbeat LAN + présence bus : montés au shell (HubPresenceMount, App.tsx)
  // depuis le 2026-08-25 — le device_type tablet est dérivé de la route.
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
  // Critique 2026-08-24 (P1) — « Item ready » n'existait que 4 secondes (un
  // toast). La moitié du métier du serveur est d'aller chercher ce qui est
  // prêt : le compte des plats au passe est dérivé du cache déjà tiré par
  // useMyTabletOrders et porté en pastille VERTE distincte sur l'onglet Orders.
  const readyCount = orders
    .filter((o) => isInFlight(o.status))
    .reduce((n, o) => n + o.items.filter((i) => i.kitchen_status === 'ready').length, 0);

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
        {/* Critique 2026-08-24 (a11y) — le h1 nommait la serveuse : le titre le
            plus fort de l'écran désignait l'élément le moins actionnable, et
            chaque vue en ajoutait un second. Le h1 de la surface est masqué
            visuellement ; le nom reste affiché, en simple texte. */}
        <h1 className="sr-only">Tablet ordering</h1>
        <span className="font-semibold text-xl truncate">{user?.full_name ?? 'Waiter'}</span>

        <div className="flex items-center gap-2">
          {/* Active table */}
          <span
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-bg-input text-sm text-text-primary"
            data-testid="tablet-active-table"
          >
            <MapPin className="h-4 w-4 text-text-secondary shrink-0" aria-hidden />
            {tableNumber ? `Table ${tableNumber}` : 'No table'}
          </span>

          {/* Pastille d'état — voir useTabletConnectionState. Critique
              2026-08-24 : pastille ET bandeau disaient le même fait sur deux
              lignes de l'écran le plus court. Un seul signal à la fois : la
              pastille ne rend que le « Online » rassurant ; les deux états
              dégradés sont portés par l'OfflineBanner (avec l'instruction),
              rendu ci-dessous pour TOUTES les vues de la coquille. */}
          {connection.state === 'online' && (
            <span
              data-testid="tablet-connection-pill"
              data-connection-state={connection.state}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-success-soft text-success text-xs font-semibold uppercase tracking-wide"
              role="status"
              aria-live="polite"
            >
              <Wifi className="h-4 w-4 shrink-0" aria-hidden />
              Online
            </span>
          )}
        </div>
      </header>

      <OfflineBanner connection={connection} />

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
          {readyCount > 0 && (
            <span
              data-testid="tablet-ready-badge"
              className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-green text-green-fg text-xs font-bold"
              aria-label={`${readyCount} item${readyCount === 1 ? '' : 's'} ready to serve`}
            >
              {readyCount}
            </span>
          )}
        </NavLink>
      </nav>

      {isLocked && <TerminalLockedOverlay />}
    </div>
  );
}
