// apps/pos/src/features/tablet/components/OfflineBanner.tsx
//
// Bandeau d'état réseau de la tablette de salle.
//
// Lot D de l'audit du 2026-08-22 — il ne prend plus deux props séparées
// (`isOnline` + `lastSync`) mais l'objet d'état complet. Deux props que
// l'appelant peut faire diverger, c'est le défaut qu'on corrige : le bandeau
// annonçait « Offline » dans un cas où le code, lui, partait en ligne.
//
// Trois états, parce que la question de la serveuse n'est pas « suis-je
// connectée ? » mais « ma commande va-t-elle partir ? » :
//
//   · online      — rien à dire, le bandeau ne se monte pas.
//   · offline_bus — cloud coupé, hub LAN debout. La commande part en cuisine
//                   par le bus et attend en file. Elle peut continuer.
//   · no_network  — cloud ET hub coupés. Rien ne part. Elle doit s'arrêter,
//                   et c'est le seul cas où l'écran doit être alarmant.

import { useEffect, useState, type JSX } from 'react';
import { WifiOff, TriangleAlert } from 'lucide-react';
import type { TabletConnection } from '../hooks/useTabletConnectionState';

export interface OfflineBannerProps {
  /** État de connexion complet — voir `useTabletConnectionState`. */
  connection: TabletConnection;
}

function formatRelative(then: Date): string {
  const diffMs = Date.now() - then.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}

export function OfflineBanner({ connection }: OfflineBannerProps): JSX.Element | null {
  const { state, lastSync } = connection;
  const isOnline = state === 'online';

  // Re-render une fois par minute pour que le temps relatif reste juste.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (isOnline) return undefined;
    const handle = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(handle);
  }, [isOnline]);

  if (isOnline) return null;

  const noNetwork = state === 'no_network';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="tablet-offline-banner"
      data-connection-state={state}
      className={
        noNetwork
          ? 'flex items-center gap-3 border-b border-danger bg-danger-soft px-4 py-2 text-sm text-danger'
          : 'flex items-center gap-3 border-b border-warning bg-warning-soft px-4 py-2 text-sm text-warning'
      }
    >
      {noNetwork ? (
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      )}
      <span className="font-semibold uppercase tracking-widest text-xs">
        {noNetwork ? 'No network' : 'Offline'}
      </span>
      <span className="text-text-secondary">
        {noNetwork
          ? 'Orders cannot be sent. Find a cashier before taking more.'
          : lastSync !== null
            ? `Orders still reach the kitchen — last synced ${formatRelative(lastSync)}.`
            : 'Orders still reach the kitchen. Menu may be incomplete.'}
      </span>
    </div>
  );
}
