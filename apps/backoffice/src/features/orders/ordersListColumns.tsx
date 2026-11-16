// apps/backoffice/src/features/orders/ordersListColumns.tsx
//
// Colonnes de la liste des commandes, sorties d'OrdersListPage (S3-21) pour
// tenir la page sous 500 lignes. Le contenu est celui de la page, plus les
// colonnes Paid et Table : un tiret dit « pas encore réglé » ou « hors salle ».

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { cn, type DataTableColumn } from '@breakery/ui';
import { formatCurrency, formatTimeWita, formatDateShortWita } from '@breakery/utils';
import { RowActionsMenu } from '@/components/RowActionsMenu.js';
import type { OrdersListLine, OrdersSortColumn } from './hooks/useOrdersList.js';
import {
  ORDER_STATUS_BADGE,
  isSettledStatus,
  orderStatusBadgeTone,
  orderStatusLabel,
  orderTypeLabel,
  paymentMethodLabel,
} from './statusMeta.js';

// Lot 5 chantier 4 — tri serveur. La liste blanche vit dans la RPC ; ici,
// seulement la correspondance colonne d'écran ↔ colonne de tri serveur.
export const SORT_TO_COLUMN_ID: Record<OrdersSortColumn, string> = {
  created_at: 'time',
  order_type: 'type',
  total:      'amount',
  status:     'status',
};
export const COLUMN_ID_TO_SORT: Record<string, OrdersSortColumn> = {
  time:   'created_at',
  type:   'order_type',
  amount: 'total',
  status: 'status',
};

export interface OrdersListColumnOptions {
  hasEditOpen:   boolean;
  hasVoid:       boolean;
  hasUnpaidVoid: boolean;
  onDetails:     (id: string) => void;
  onEditItems:   (id: string, orderNumber: string) => void;
  onVoid:        (id: string, orderNumber: string) => void;
  onVoidUnpaid:  (id: string) => void;
}

const DASH = <span className="text-text-subtle" aria-hidden>—</span>;

/** Heure sur la première ligne, jour en second — même rendu pour Created et Paid. */
function timeCell(iso: string): JSX.Element {
  return (
    <span className="block whitespace-nowrap font-data text-xs leading-tight tabular-nums">
      {formatTimeWita(iso)}
      <span className="block text-text-muted">{formatDateShortWita(iso)}</span>
    </span>
  );
}

export function buildOrdersListColumns(o: OrdersListColumnOptions): readonly DataTableColumn<OrdersListLine>[] {
  return [
    {
      id: 'number', header: 'Order #', width: '7.5rem',
      render: (r) => (
        <Link
          to={`/backoffice/orders/${r.id}`}
          // Or, et non `info` (critique du 2026-08-21, P1-3). DESIGN.md donne
          // les liens à l'or ; le bleu du thème sert de première série de
          // graphique. Une couleur, un sens.
          className="font-data text-xs text-gold underline [text-decoration-color:color-mix(in_srgb,transparent,var(--gold-base)_70%)] underline-offset-[3px] hover:[text-decoration-color:var(--gold-base)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          #{r.order_number.replace(/^#+/, '')}
        </Link>
      ),
    },
    {
      // L'id reste `time` : c'est lui que porte le tri serveur `created_at`.
      id: 'time', header: 'Created', width: '7rem', sortable: true,
      render: (r) => timeCell(r.created_at),
    },
    {
      id: 'paid', header: 'Paid', width: '7rem',
      render: (r) => (r.paid_at !== null ? timeCell(r.paid_at) : DASH),
    },
    {
      id: 'table', header: 'Table', width: '5rem',
      render: (r) => (
        r.table_number !== null
          ? <span className="font-data text-xs text-text-secondary">{r.table_number}</span>
          : DASH
      ),
    },
    {
      id: 'type', header: 'Type', width: '6.5rem', sortable: true,
      render: (r) => <span className="text-text-secondary">{orderTypeLabel(r.order_type)}</span>,
    },
    {
      id: 'customer', header: 'Customer', width: '13rem',
      render: (r) => (
        r.customer_name !== null
          ? (
            <span className="block max-w-[13rem] truncate text-text-primary" title={r.customer_name}>
              {r.customer_name}
            </span>
          )
          : DASH
      ),
    },
    {
      id: 'items', header: 'Items', align: 'right', width: '4.5rem',
      render: (r) => <span className="font-data tabular-nums">{r.items_count}</span>,
    },
    {
      // 9,25rem : « Rp 150.000.000 » en JetBrains Mono 14 px demande 145,6 px ;
      // la cellule étant `whitespace-nowrap`, plus étroite elle poussait la
      // table entière en défilement horizontal.
      id: 'amount', header: 'Amount', align: 'right', width: '9.25rem', sortable: true,
      render: (r) => <span className="whitespace-nowrap font-data tabular-nums">{formatCurrency(r.total)}</span>,
    },
    {
      id: 'status', header: 'Status', width: '9.5rem', sortable: true,
      render: (r) => (
        <span className={cn(ORDER_STATUS_BADGE, orderStatusBadgeTone(r.status))}>
          {orderStatusLabel(r.status)}
        </span>
      ),
    },
    {
      id: 'payment', header: 'Payment', width: '7.5rem',
      // RÉGLÉ = méthode enregistrée OU statut porteur d'argent : une facture
      // B2B encaissée (statut paid, zéro ligne order_payments) lit « Paid »
      // (review PR #367).
      render: (r) => (
        r.payment_method_primary !== null
          ? <span className="text-text-secondary">{paymentMethodLabel(r.payment_method_primary)}</span>
          : isSettledStatus(r.status)
            ? <span className="text-success">Paid</span>
            : r.status === 'voided'
              ? DASH
              : <span className="text-warning">Unpaid</span>
      ),
    },
    {
      // Une seule cible depuis la convergence sur le menu `…` (critique du
      // 2026-08-31, P1) : 4rem.
      id: 'actions', header: <span className="sr-only">Row actions</span>, align: 'right', width: '4rem',
      render: (r) => (
        <span className="inline-flex items-center justify-end">
          <RowActionsMenu
            subject={r.order_number}
            testId={`row-actions-${r.id}`}
            entries={[
              // Le détail d'abord : c'est la lecture, et la seule entrée
              // toujours présente. `Void` descend en dernier ET porte `danger`.
              { key: 'details', label: 'View details', testId: `row-details-${r.id}`,
                activate: () => { o.onDetails(r.id); } },
              ...(o.hasEditOpen && (r.status === 'draft' || r.status === 'pending_payment')
                ? [{ key: 'edit', label: 'Edit items', testId: `row-edit-${r.id}`,
                     activate: () => { o.onEditItems(r.id, r.order_number); } }]
                : []),
              ...(o.hasVoid && (r.status === 'paid' || r.status === 'completed')
                ? [{ key: 'void', label: 'Void order', danger: true, testId: `row-void-${r.id}`,
                     activate: () => { o.onVoid(r.id, r.order_number); } }]
                : []),
              ...(o.hasUnpaidVoid && (r.status === 'draft' || r.status === 'pending_payment')
                ? [{ key: 'void-unpaid', label: 'Void unpaid order', danger: true, testId: `row-void-unpaid-${r.id}`,
                     activate: () => { o.onVoidUnpaid(r.id); } }]
                : []),
            ]}
          />
        </span>
      ),
    },
  ];
}
