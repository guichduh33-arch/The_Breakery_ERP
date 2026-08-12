// apps/backoffice/src/pages/btob/B2BOrdersPage.tsx
//
// Archétype LIST — les commandes professionnelles, une ligne par commande.
//
// La source est `view_b2b_invoices` : côté base, une facture B2B n'est pas un
// objet séparé, c'est la commande vue sous son angle comptable (`o.id AS
// invoice_id`). Cette page la regarde sous l'angle commande.
//
// Le clic déplie la commande sur ses lignes, chargées à ce moment-là. C'est ce
// qui permet de garder une liste dense — le détail ne coûte rien tant qu'on ne
// le demande pas, et il évite un aller-retour vers une page de détail pour
// répondre à « qu'est-ce qu'il y avait dedans ? ».

import { useMemo, useState, type JSX } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { cn, DataTable, type DataTableColumn } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import {
  ORDER_STATUS_BADGE,
  orderStatusBadgeTone,
  orderStatusLabel,
} from '@/features/orders/statusMeta.js';
import {
  B2B_SETTLEMENT_BADGE,
  B2B_SETTLEMENT_TONE,
} from '@/features/btob/paymentStatusMeta.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useB2bInvoices, type B2bInvoiceRow } from '@/features/btob/hooks/useB2bInvoices.js';
import { B2bOrderItemsPanel } from '@/features/btob/components/B2bOrderItemsPanel.js';
import { CreateB2bOrderModal } from '@/features/btob/components/CreateB2bOrderModal.js';

type PaymentFilter = 'all' | 'unpaid' | 'paid';

function orderDate(iso: string | null): string {
  return iso === null || iso === '' ? '—' : iso.slice(0, 10);
}

/** Le statut de commande, et l'impayé qui le double quand il existe. */
function statusBadges(row: B2bInvoiceRow): JSX.Element {
  const unpaid = Number(row.outstanding) > 0;
  // L'annulation B2B pose `voided` (cancel_b2b_order) — « cancelled » n'existe
  // pas dans l'enum ; on garde les deux gardes tant que la vue type en string.
  const dead = row.order_status === 'voided' || row.order_status === 'cancelled';
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(ORDER_STATUS_BADGE, orderStatusBadgeTone(row.order_status))}>
        {orderStatusLabel(row.order_status)}
      </span>
      {unpaid && !dead && (
        <span
          className={cn(B2B_SETTLEMENT_BADGE, B2B_SETTLEMENT_TONE.unpaid)}
          title={`${formatIdr(row.outstanding)} still outstanding`}
        >
          unpaid
        </span>
      )}
    </div>
  );
}

export default function B2BOrdersPage(): JSX.Element {
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const canCreate = useAuthStore((s) => s.hasPermission('pos.sale.create'));

  const { data, isLoading, error } = useB2bInvoices(undefined, false);

  // La vue trie du plus ancien au plus récent pour l'imputation FIFO des
  // règlements. Une liste de commandes se lit dans l'autre sens : la dernière
  // commande est celle dont on parle.
  const allRows = useMemo(
    () => [...(data ?? [])].sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1)),
    [data],
  );

  const rows = useMemo(() => {
    if (payment === 'unpaid') return allRows.filter((r) => Number(r.outstanding) > 0);
    if (payment === 'paid') return allRows.filter((r) => Number(r.outstanding) <= 0);
    return allRows;
  }, [allRows, payment]);

  const counters = useMemo<ListCounter[]>(() => {
    const unpaid = allRows.filter((r) => Number(r.outstanding) > 0);
    const outstanding = unpaid.reduce((sum, r) => sum + Number(r.outstanding), 0);
    return [
      { id: 'all', label: 'All orders', value: allRows.length, onSelect: () => { setPayment('all'); } },
      {
        id: 'unpaid',
        label: 'Unpaid',
        value: unpaid.length,
        tone: unpaid.length > 0 ? 'warning' : 'neutral',
        onSelect: () => { setPayment('unpaid'); },
      },
      {
        id: 'paid',
        label: 'Settled',
        value: allRows.length - unpaid.length,
        tone: 'success',
        onSelect: () => { setPayment('paid'); },
      },
      {
        id: 'outstanding',
        label: 'Outstanding',
        value: formatIdr(outstanding),
        tone: outstanding > 0 ? 'danger' : 'neutral',
        title: 'Total still owed across every unpaid order.',
      },
    ];
  }, [allRows]);

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columns: DataTableColumn<B2bInvoiceRow>[] = [
    {
      id: 'order_number',
      header: 'Order no.',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          {expanded.has(r.invoice_id)
            ? <ChevronDown className="h-3.5 w-3.5 text-text-inert" aria-hidden />
            : <ChevronRight className="h-3.5 w-3.5 text-text-inert" aria-hidden />}
          <span className="font-data text-[12.5px] text-text-primary">{r.order_number}</span>
        </span>
      ),
    },
    {
      id: 'invoice_date',
      header: 'Created',
      render: (r) => <span className="font-data text-[12.5px] tabular-nums">{orderDate(r.invoice_date)}</span>,
    },
    {
      id: 'customer',
      header: 'Customer',
      render: (r) => (
        <span className="text-[13px] text-text-primary">
          {r.b2b_company_name ?? r.customer_name ?? '—'}
        </span>
      ),
    },
    {
      id: 'pickup_date',
      header: 'Pickup',
      // Le libellé dit « Pickup » et non « Delivery » : la marchandise est
      // retirée au magasin, il n'existe aucune tournée. Un en-tête qui en
      // promettrait une ferait attendre un flux qui n'existe pas.
      render: (r) =>
        r.pickup_date === null ? (
          <span className="font-data text-[12.5px] text-text-inert" title="No pickup day agreed on this order">
            not set
          </span>
        ) : (
          <span className="font-data text-[12.5px] tabular-nums">{r.pickup_date.slice(0, 10)}</span>
        ),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      render: (r) => <span className="font-data text-[12.5px]">{formatIdr(r.invoice_total)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      render: statusBadges,
    },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>B2B</span>
        <span className="text-text-inert" aria-hidden>›</span>
        <span className="text-text-secondary">Orders</span>
      </nav>

      <PageHeader
        title="B2B orders"
        subtitle="One row per wholesale order. Click a row to see what was in it. Orders are collected in store — there is no delivery run."
        actions={
          <button
            type="button"
            className={TOOLBAR_BTN_PRIMARY}
            disabled={!canCreate}
            onClick={() => { setCreateOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> New B2B Order
          </button>
        }
      />

      <ListCounterStrip
        counters={counters}
        activeId={payment}
        ariaLabel="B2B order filters"
        data-testid="b2b-orders-counters"
      />

      {error !== null ? (
        <p className="text-sm text-danger" role="alert">
          Could not load B2B orders: {error.message}
        </p>
      ) : (
        <DataTable<B2bInvoiceRow>
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.invoice_id}
          isLoading={isLoading}
          density="compact"
          onRowClick={(r) => { toggle(r.invoice_id); }}
          expandedKeys={expanded}
          renderExpanded={(r) => (
            <B2bOrderItemsPanel orderId={r.invoice_id} orderTotal={Number(r.invoice_total)} />
          )}
          emptyTitle="No B2B order"
          emptyDescription={
            payment === 'all'
              ? 'Wholesale orders appear here as soon as one is created.'
              : `No ${payment === 'unpaid' ? 'unpaid' : 'settled'} order right now.`
          }
          data-testid="b2b-orders-table"
          footer={
            <span className="font-data text-[11px] text-text-muted tabular-nums">
              {rows.length} of {allRows.length}
            </span>
          }
        />
      )}

      <CreateB2bOrderModal open={createOpen} onClose={() => { setCreateOpen(false); }} />
    </div>
  );
}
