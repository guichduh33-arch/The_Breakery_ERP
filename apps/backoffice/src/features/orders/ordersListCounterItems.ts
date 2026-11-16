// apps/backoffice/src/features/orders/ordersListCounterItems.ts
//
// Bandes de compteurs de la liste des commandes, sorties d'OrdersListPage
// (S3-21) pour tenir la page sous 500 lignes. Contenu inchangé : la page les
// mémoïse avec les mêmes dépendances qu'avant.

import { formatCurrency } from '@breakery/utils';
import type { ListCounter } from '@/components/ListCounterStrip.js';
import type { OrdersCounters } from './hooks/useOrdersCounters.js';
import { ORDER_STATUS, ORDER_STATUS_ORDER, type OrderStatus } from './statusMeta.js';

export function statusCell(c: OrdersCounters | undefined, s: OrderStatus): number {
  return c?.by_status[s]?.count ?? 0;
}

/** Compteurs cliquables par statut (ADR-025 D2/D3). */
export function buildStatusCounterItems(
  c: OrdersCounters | undefined,
  countersDown: boolean,
  pick: (next: OrderStatus | '') => void,
): ListCounter[] {
  return [
    {
      id: 'all',
      label: 'All orders',
      value: countersDown ? '—' : (c?.total.count ?? 0),
      onSelect: () => { pick(''); },
    },
    ...ORDER_STATUS_ORDER.map((s): ListCounter => {
      const spec = ORDER_STATUS[s];
      const value = statusCell(c, s);
      return {
        id: s,
        label: spec.label,
        value: countersDown ? '—' : value,
        ...(spec.tone !== undefined && value > 0 && !countersDown ? { tone: spec.tone } : {}),
        onSelect: () => { pick(s); },
      };
    }),
  ];
}

// Bande d'argent (ADR-025 D5 amendée) — informative, non cliquable. Les
// sommes sont des TOTAUX DE COMMANDES réglées/non réglées ; le remboursé
// s'affiche à côté au lieu d'être soustrait en silence.
export function buildMoneyCounterItems(
  c: OrdersCounters | undefined,
  countersDown: boolean,
  start: string,
  end: string,
): ListCounter[] {
  return [
    {
      id: 'amount-total',
      label: 'Window total',
      value: countersDown ? '—' : formatCurrency(c?.total.amount ?? 0),
      title: `Sum of order totals between ${start} and ${end}, current filters applied — voided included.`,
    },
    {
      id: 'amount-paid',
      label: 'Settled',
      value: countersDown ? '—' : formatCurrency(c?.paid.amount ?? 0),
      ...((c?.paid.count ?? 0) > 0 && !countersDown ? { tone: 'success' as const } : {}),
      title: `${(c?.paid.count ?? 0).toLocaleString('id-ID')} orders with a recorded payment or a paid/completed status (B2B settlements carry no payment row). Sum of order totals — refunds are shown separately.`,
    },
    {
      id: 'amount-unpaid',
      label: 'Unpaid',
      value: countersDown ? '—' : formatCurrency(c?.unpaid.amount ?? 0),
      ...((c?.unpaid.count ?? 0) > 0 && !countersDown ? { tone: 'warning' as const } : {}),
      title: `${(c?.unpaid.count ?? 0).toLocaleString('id-ID')} orders not settled yet, voided excluded.`,
    },
    {
      id: 'amount-refunded',
      label: 'Refunded',
      // « − Rp 0 » affichait un moins permanent devant un zéro : le signe ne
      // se montre que lorsqu'il y a réellement de l'argent rendu.
      value: countersDown
        ? '—'
        : (c?.refunded.amount ?? 0) > 0
          ? `− ${formatCurrency(c?.refunded.amount ?? 0)}`
          : formatCurrency(0),
      ...((c?.refunded.count ?? 0) > 0 && !countersDown ? { tone: 'danger' as const } : {}),
      title: `${(c?.refunded.count ?? 0).toLocaleString('id-ID')} orders carry a refund in this window.`,
    },
  ];
}
