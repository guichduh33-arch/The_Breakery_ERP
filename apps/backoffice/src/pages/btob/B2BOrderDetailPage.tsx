// apps/backoffice/src/pages/btob/B2BOrderDetailPage.tsx
//
// Fiche commande B2B — instance de l'archétype DOCUMENT, comme la fiche
// commande POS (`pages/orders/OrderDetailPage.tsx`) : le corps du document à
// gauche (paires libellé/valeur, lignes, activité), l'argent dans le rail de
// droite (Total / Paid / Outstanding). Les deux statuts INDÉPENDANTS — retrait
// et règlement — cohabitent dans l'en-tête : une commande B2B peut être livrée
// sans être payée.
//
// Le fil d'Ariane et le titre se rendent dans TOUS les états (chargement,
// erreur, introuvable) : c'est dans l'erreur qu'on a le plus besoin du retour
// vers la liste. Le lien de retour conserve la recherche de la liste
// (`location.search`) — le retour rend la liste qu'on regardait.

import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { formatCurrency, formatDate, formatDateTimeShortWita } from '@breakery/utils';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import { Button, Card } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { Breadcrumb } from '@/components/Breadcrumb.js';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { useHasPendingFinancial } from '@/lib/useFinancialAttempt.js';
import { B2bOrderActivity } from '@/features/btob/components/B2bOrderActivity.js';
import { B2bOrderItemsPanel } from '@/features/btob/components/B2bOrderItemsPanel.js';
import { B2bOrderStatus } from '@/features/btob/components/B2bOrderStatus.js';
import { B2bPickupDialog } from '@/features/btob/components/B2bPickupDialog.js';
import { EditB2bOrderDialog } from '@/features/btob/components/EditB2bOrderDialog.js';
import { RecordB2bPaymentModal } from '@/features/btob/components/RecordB2bPaymentModal.js';
import { useDownloadB2bInvoice } from '@/features/btob/hooks/useDownloadB2bInvoice.js';
import {
  B2B_INVOICES_QUERY_KEY,
  type B2bInvoiceRow,
} from '@/features/btob/hooks/useB2bInvoices.js';

const SECTION_LABEL = 'font-body text-lg font-medium tracking-tight text-text-primary';

// `invoice_date`, `paid_at` et `b2b_delivered_at` sont des instants : format de
// table du BO. `pickup_date` est une date seule (colonne `date`).
const instant = (value: string | null | undefined): string =>
  value ? formatDateTimeShortWita(value) : '—';
const day = (value: string | null | undefined): string =>
  value ? formatDate(value) : '—';

export default function B2BOrderDetailPage(): JSX.Element {
  const { orderId } = useParams<{ orderId: string }>();
  const location = useLocation();
  const canPickup = useAuthStore(
    (s) => s.hasPermission('b2b.read') && s.hasPermission('b2b.order.create'),
  );
  const canPay = useAuthStore((s) => s.hasPermission('b2b.payment.record'));
  const canPrint = useAuthStore((s) => s.hasPermission('b2b.read') && s.hasPermission('reports.export'));
  const invoicePdf = useDownloadB2bInvoice();
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pickup, setPickup] = useState<'schedule' | 'deliver' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const invoiceIds = useMemo(() => (orderId ? [orderId] : []), [orderId]);
  const query = useQuery({
    queryKey: [...B2B_INVOICES_QUERY_KEY, 'detail', orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('view_b2b_invoices')
        .select('*')
        .eq('invoice_id', orderId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as B2bInvoiceRow | null;
    },
  });
  const order = query.data;
  const pendingPayment = useHasPendingFinancial('payment', order?.customer_id ?? '');
  const pendingEdit = useHasPendingFinancial('b2bEdit', orderId ?? '');
  const editable = order?.order_status === 'b2b_pending' && !order.b2b_delivered_at
    && !order.paid_at && Number(order.amount_paid) === 0;

  const listUrl = `/backoffice/b2b/orders${location.search}`;
  const crumbs = (
    <Breadcrumb
      items={[
        { label: 'Sales' },
        { label: 'B2B orders', to: listUrl },
        ...(order ? [{ label: `#${order.order_number.replace(/^#+/, '')}`, mono: true }] : []),
      ]}
    />
  );

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-[13px]" aria-busy="true">
        {crumbs}
        <PageHeader title="B2B order" />
        <p role="status" className="sr-only">Loading order…</p>
        <div className="h-64 animate-pulse rounded-md bg-surface-4 motion-reduce:animate-none" />
      </div>
    );
  }
  // Une erreur de refetch en arrière-plan ne démonte pas la fiche (ni une
  // modale ouverte) : la page d'erreur ne remplace que l'absence de données.
  if (query.isError && !query.data) {
    return (
      <div className="flex flex-col gap-[13px]">
        {crumbs}
        <PageHeader title="B2B order" />
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-red bg-bg-elevated p-4 text-sm text-red-as-text">
          <span>
            Could not load this order.{' '}
            <span className="font-data text-xs">{query.error.message}</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void query.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="flex flex-col gap-[13px]">
        {crumbs}
        <PageHeader title="B2B order" />
        <p className="rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm text-text-secondary">
          Order not found or no longer available.
        </p>
      </div>
    );
  }

  const showPayment = Number(order.outstanding) > 0 || (canPay && pendingPayment);

  return (
    <div className="flex flex-col gap-[13px]">
      {crumbs}
      <PageHeader
        title={`B2B order ${order.order_number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {/* Statuts indépendants : retrait et règlement. */}
            <B2bOrderStatus order={order} />
            <span>{order.b2b_company_name ?? order.customer_name}</span>
          </span>
        }
        actions={
          <>
            <button
              type="button"
              className={TOOLBAR_BTN_SECONDARY}
              disabled={!canPrint || invoicePdf.isPending}
              aria-busy={invoicePdf.isPending}
              title={!canPrint ? 'You do not have permission to export B2B invoices.' : undefined}
              onClick={() => {
                setPdfError(null);
                invoicePdf.download({
                  orderId: order.invoice_id,
                  invoiceNumber: order.invoice_number,
                  orderNumber: order.order_number,
                }, {
                  onError: () => setPdfError('Could not generate the invoice PDF. Please try again.'),
                });
              }}
            >
              <Printer className={TOOLBAR_ICON} aria-hidden />
              {invoicePdf.isPending ? 'Preparing PDF…' : 'Print PDF'}
            </button>
            {!order.b2b_delivered_at && (
              <>
                <button
                  type="button"
                  className={TOOLBAR_BTN_SECONDARY}
                  disabled={!canPickup}
                  onClick={() => {
                    setPickup('schedule');
                  }}
                >
                  Change pickup date
                </button>
                <button
                  type="button"
                  className={TOOLBAR_BTN_SECONDARY}
                  disabled={!canPickup}
                  onClick={() => {
                    setPickup('deliver');
                  }}
                >
                  Mark delivered
                </button>
              </>
            )}
            {showPayment && (
              <button
                type="button"
                className={TOOLBAR_BTN_PRIMARY}
                disabled={!canPay}
                onClick={() => {
                  setPaymentOpen(true);
                }}
              >
                {pendingPayment ? 'Check pending payment' : 'Record payment'}
              </button>
            )}
          </>
        }
      />
      {pdfError && (
        <p role="alert" className="rounded-md border border-red bg-bg-elevated p-3 text-sm text-red-as-text">
          {pdfError}
        </p>
      )}

      <div className="grid items-start gap-[13px] lg:grid-cols-[1.7fr_1fr]">
        {/* ------------------------------------------------ corps du document */}
        <div className="flex min-w-0 flex-col gap-[13px]">
          <Card variant="default" padding="md" className="shadow-none">
            <h2 className={SECTION_LABEL}>Order</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              <MetaPair label="Customer">{order.b2b_company_name ?? order.customer_name ?? '—'}</MetaPair>
              <MetaPair label="Created" mono>{instant(order.invoice_date)}</MetaPair>
              <MetaPair label="Pickup date" mono>{day(order.pickup_date)}</MetaPair>
              <MetaPair label="Collected" mono>{instant(order.b2b_delivered_at)}</MetaPair>
              <MetaPair label="Paid on" mono>{instant(order.paid_at)}</MetaPair>
            </dl>
          </Card>

          <Card variant="default" padding="md" className="shadow-none">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className={SECTION_LABEL}>Order items</h2>
              {(editable || pendingEdit) && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canPickup || pendingPayment}
                  onClick={() => { setEditOpen(true); }}
                >
                  {pendingEdit ? 'Check pending edit' : 'Edit order'}
                </Button>
              )}
            </div>
            {!editable && !pendingEdit && (
              <p className="mb-3 text-sm text-text-muted">
                Order items can only be edited before collection and any payment.
              </p>
            )}
            <B2bOrderItemsPanel
              orderId={order.invoice_id}
              orderTotal={Number(order.invoice_total)}
            />
          </Card>

          <B2bOrderActivity orderId={order.invoice_id} />
        </div>

        {/* ------------------------------------------------------ rail d'argent */}
        <Card variant="default" padding="md" className="shadow-none">
          <h2 className={SECTION_LABEL}>Totals</h2>
          <dl className="mt-3 space-y-1.5 text-sm" data-testid="b2b-order-money">
            <MoneyRow label="Total" value={formatCurrency(order.invoice_total)} />
            <MoneyRow label="Paid" value={formatCurrency(order.amount_paid)} />
            <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-2">
              <dt className="text-sm font-semibold text-text-primary">Outstanding</dt>
              <dd className="whitespace-nowrap font-data text-[23px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-text-primary">
                {formatCurrency(order.outstanding)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {pickup && (
        <B2bPickupDialog
          order={order}
          delivered={pickup === 'deliver'}
          onClose={() => {
            setPickup(null);
          }}
        />
      )}
      {editOpen && (
        <EditB2bOrderDialog
          orderId={order.invoice_id}
          orderNumber={order.order_number}
          onClose={() => { setEditOpen(false); }}
        />
      )}
      {paymentOpen && (
        <RecordB2bPaymentModal
          open
          initialCustomerId={order.customer_id}
          initialInvoiceIds={invoiceIds}
          onClose={() => {
            setPaymentOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function MetaPair({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="font-data text-xs font-semibold uppercase tracking-widest text-text-muted">{label}</dt>
      <dd className={mono === true ? 'mt-0.5 font-data text-sm tabular-nums text-text-primary' : 'mt-0.5 text-sm text-text-primary'}>
        {children}
      </dd>
    </div>
  );
}

// Le libellé plie, le montant jamais (même invariant que la fiche commande POS).
function MoneyRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 truncate text-sm text-text-secondary">{label}</dt>
      <dd className="whitespace-nowrap font-data text-sm tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}
