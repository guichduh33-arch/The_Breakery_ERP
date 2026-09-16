import { useMemo, useState, type JSX } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDateShortWita } from '@breakery/utils';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import { Button } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { B2bOrderItemsPanel } from '@/features/btob/components/B2bOrderItemsPanel.js';
import { B2bOrderStatus } from '@/features/btob/components/B2bOrderStatus.js';
import { B2bPickupDialog } from '@/features/btob/components/B2bPickupDialog.js';
import { RecordB2bPaymentModal } from '@/features/btob/components/RecordB2bPaymentModal.js';
import {
  B2B_INVOICES_QUERY_KEY,
  type B2bInvoiceRow,
} from '@/features/btob/hooks/useB2bInvoices.js';
import './b2b-orders.css';

export default function B2BOrderDetailPage(): JSX.Element {
  const { orderId } = useParams<{ orderId: string }>();
  const location = useLocation();
  const canPickup = useAuthStore(
    (s) => s.hasPermission('b2b.read') && s.hasPermission('pos.sale.create'),
  );
  const canPay = useAuthStore((s) => s.hasPermission('b2b.payment.record'));
  const [pickup, setPickup] = useState<'schedule' | 'deliver' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
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
  const date = (value: string | null | undefined): string =>
    value ? formatDateShortWita(value) : '—';
  return (
    <div className="b2b-orders-page mx-auto flex w-full max-w-6xl flex-col gap-8">
      <Link
        className={`text-sm text-text-secondary hover:underline ${FOCUS_RING}`}
        to={`/backoffice/b2b/orders${location.search}`}
      >
        ← Back to B2B orders
      </Link>
      {query.isLoading && <p role="status">Loading order…</p>}
      {query.isError && (
        <div role="alert">
          <p>Could not load this order: {query.error.message}</p>
          <Button
            onClick={() => {
              void query.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {!query.isLoading && !query.isError && !order && (
        <p>Order not found or no longer available.</p>
      )}
      {order && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-sm text-text-muted">B2B order</p>
              <h1 className="text-2xl font-semibold">{order.order_number}</h1>
              <p className="mt-2 text-lg">{order.b2b_company_name ?? order.customer_name}</p>
            </div>
            <B2bOrderStatus order={order} />
          </header>
          <section
            aria-label="Order dates and payment"
            className="grid gap-6 rounded-md border border-border-subtle bg-bg-elevated p-6 sm:grid-cols-2 lg:grid-cols-4"
          >
            {[
              ['Created', date(order.invoice_date)],
              ['Pickup date', date(order.pickup_date)],
              ['Collected', date(order.b2b_delivered_at)],
              ['Paid on', date(order.paid_at)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="mb-2 text-sm text-text-muted">{label}</p>
                <p className="text-base font-medium">{value}</p>
              </div>
            ))}
          </section>
          <section className="rounded-md border border-border-subtle bg-bg-elevated p-6">
            <h2 className="mb-4 text-lg font-semibold">Order items</h2>
            <B2bOrderItemsPanel
              orderId={order.invoice_id}
              orderTotal={Number(order.invoice_total)}
            />
          </section>
          <section className="flex flex-wrap justify-between gap-8 rounded-md border border-border-subtle bg-bg-elevated p-6">
            <div>
              <h2 className="mb-4 text-lg font-semibold">Pickup and payment</h2>
              <div className="flex flex-wrap gap-3">
                {!order.b2b_delivered_at && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={!canPickup || query.isError}
                      onClick={() => {
                        setPickup('schedule');
                      }}
                    >
                      Change pickup date
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!canPickup || query.isError}
                      onClick={() => {
                        setPickup('deliver');
                      }}
                    >
                      Mark delivered
                    </Button>
                  </>
                )}
                {Number(order.outstanding) > 0 && (
                  <Button
                    disabled={!canPay || query.isError}
                    onClick={() => {
                      setPaymentOpen(true);
                    }}
                  >
                    Record payment
                  </Button>
                )}
              </div>
            </div>
            <dl className="grid min-w-64 grid-cols-2 gap-x-8 gap-y-3">
              <dt>Total</dt>
              <dd className="text-right">{formatCurrency(order.invoice_total)}</dd>
              <dt>Paid</dt>
              <dd className="text-right">{formatCurrency(order.amount_paid)}</dd>
              <dt className="font-semibold">Outstanding</dt>
              <dd className="text-right font-semibold">{formatCurrency(order.outstanding)}</dd>
            </dl>
          </section>
          {pickup && (
            <B2bPickupDialog
              order={order}
              delivered={pickup === 'deliver'}
              onClose={() => {
                setPickup(null);
              }}
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
        </>
      )}
    </div>
  );
}
