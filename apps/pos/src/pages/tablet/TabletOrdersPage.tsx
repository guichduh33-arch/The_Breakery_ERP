import { useEffect, useMemo, useState, type JSX } from 'react';
import { useLocation } from 'react-router-dom';
import { TabletOrderCard } from '@breakery/ui';
import { useMyTabletOrders } from '@/features/tablet/hooks/useMyTabletOrders';
import { useTabletOrderStatusListener } from '@/features/tablet/hooks/useTabletOrderStatusListener';
import { TabletOrderConfirmation } from '@/features/tablet/components/TabletOrderConfirmation';
import type { TabletOrderCardOrder } from '@breakery/ui';

interface TabletOrdersLocationState {
  justSentOrderId?: string | null;
}

/** Horloge unique de la page — chaque carte montait son propre setInterval +
 *  re-render à la seconde (jusqu'à 50 timers sur une liste pleine) ; un seul
 *  tick suffit, passé aux cartes via la prop `now`. */
function usePageNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const handle = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}

export default function TabletOrdersPage(): JSX.Element {
  const { data: orders = [], isLoading } = useMyTabletOrders();
  useTabletOrderStatusListener();
  const now = usePageNow();

  const location = useLocation();
  const justSentOrderId = (location.state as TabletOrdersLocationState | null)?.justSentOrderId ?? null;
  const justSentOrder = useMemo(
    () =>
      justSentOrderId != null
        ? (orders.find((o) => o.id === justSentOrderId) as unknown as TabletOrderCardOrder | undefined)
        : undefined,
    [orders, justSentOrderId],
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      {justSentOrderId != null && <TabletOrderConfirmation order={justSentOrder} />}
      <h2 className="text-xs uppercase tracking-widest font-semibold text-text-secondary mb-4">My Orders</h2>
      {isLoading && <p className="text-text-secondary text-sm">Loading…</p>}
      {!isLoading && orders.length === 0 && (
        <p className="text-text-muted text-sm">No orders yet. Go capture your first one.</p>
      )}
      <div className="grid gap-4 max-w-2xl">
        {orders.map((order) => {
          const isJustSent = order.id === justSentOrderId;
          return (
            <div key={order.id} className={isJustSent ? 'rounded-xl ring-2 ring-success' : undefined}>
              {/* ADR-010 — aucune annulation depuis la salle. Les lignes d'une
                  commande tablette sont posées `is_locked` dès la création :
                  les retirer exige un manager ET une déclaration de perte, ce
                  que seul le flux cancel-item du POS sait faire. Ne pas passer
                  `onCancel` retire le bouton (la carte le conditionne dessus). */}
              <TabletOrderCard order={order as unknown as TabletOrderCardOrder} now={now} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
