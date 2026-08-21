// apps/backoffice/src/features/dashboard/components/OpenOrdersCard.tsx
//
// Écran 1c — état du plancher : ce qui est ouvert, où, depuis combien de temps.
//
// L'ancienneté est la colonne qui porte l'information. Une commande ouverte
// depuis 48 minutes n'est pas « une commande de plus » : c'est soit une table
// oubliée, soit un ticket qui n'est jamais parti en cuisine. Les seuils
// (30 min ambre, 45 min rouge) rendent ce basculement visible sans lecture.
//
// La destination est reconstruite SERVEUR selon le type de commande — le
// handoff dessinait « Delivery · Gojek », mais `orders` ne porte aucune colonne
// de canal de livraison : ce libellé n'a pas de source et se réduit à
// « Delivery ». On n'invente pas un canal côté client.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@breakery/ui';
import { DashboardCard, LiveMarker } from './DashboardCard.js';
import { formatIdr, formatIdrShort, formatMinutes } from '../utils/format.js';
import type { OpenOrdersPanel } from '../hooks/useDashboardPanels.js';

function ageTone(minutes: number): string {
  if (minutes > 45) return 'text-danger font-semibold';
  if (minutes >= 30) return 'text-warning font-semibold';
  return 'text-text-muted';
}

export function OpenOrdersCard({
  panel, isLoading, isRestricted, error,
}: {
  panel: OpenOrdersPanel | null;
  isLoading: boolean;
  isRestricted: boolean;
  error: Error | null;
}): JSX.Element {
  const rows = panel?.orders ?? [];
  const over45 = panel?.over_45_count ?? 0;

  return (
    <DashboardCard
      title="Open orders"
      aside={<LiveMarker />}
      subtitle={
        panel === null
          ? undefined
          : (
              <>
                <span className="font-data tabular-nums">{panel.open_count}</span> open ·{' '}
                <span className="font-data tabular-nums" title={formatIdr(panel.open_total)}>
                  {formatIdrShort(panel.open_total)}
                </span>
                {' '}in the room
              </>
            )
      }
      isLoading={isLoading}
      isRestricted={isRestricted}
      error={error}
      testId="card-open-orders"
      footer={
        <>
          {over45 > 0 && (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
              <span className="text-text-secondary">
                <span className="font-data tabular-nums">{over45}</span> order{over45 > 1 ? 's' : ''} open over 45 min
              </span>
            </>
          )}
          <Link to="/backoffice/orders" className="ml-auto font-medium text-gold">
            Open floor
          </Link>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-text-muted">No order is open right now.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((o) => (
            <li key={o.id} className="flex items-baseline gap-2 text-xs">
              <span className="w-11 shrink-0 font-data text-text-muted">{o.order_number}</span>
              <span className="min-w-0 flex-1 truncate text-text-primary">{o.destination}</span>
              <span className="shrink-0 font-data tabular-nums text-text-primary">{formatIdr(o.total)}</span>
              <span className={cn('w-12 shrink-0 whitespace-nowrap text-right font-data tabular-nums', ageTone(o.minutes_open))}>
                {formatMinutes(o.minutes_open)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
