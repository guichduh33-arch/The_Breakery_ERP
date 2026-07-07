// apps/backoffice/src/pages/orders/OrderDetailPage.tsx
//
// Session 31 / Wave 2.B — Read-only order detail page (no actions).
// Route-level permission gate `orders.read` (wired in routes/index.tsx).

import type { JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, Button } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useOrderDetail } from '@/features/orders/hooks/useOrderDetail.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'completed' || status === 'paid'
      ? 'bg-success-soft text-success'
      : status === 'voided'
        ? 'bg-danger-soft text-danger'
        : status === 'refunded'
          ? 'bg-warning-soft text-warning'
          : 'bg-surface-2 text-text-secondary';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>
  );
}

function fmtIdr(amount: number | null): string {
  return `Rp ${formatIdr(Number(amount ?? 0))}`;
}

export function OrderDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useOrderDetail(id);

  if (isLoading || !data) {
    return <div className="p-8">Loading…</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" asChild>
          <Link to="/backoffice/orders">
            <ArrowLeft size={16} /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold font-fraunces">
          Order #{data.order_number}
        </h1>
        <StatusBadge status={data.status} />
        <span className="text-sm text-muted-foreground">{data.order_type}</span>
        <span className="text-sm text-muted-foreground">
          · {new Date(data.created_at).toLocaleString('id-ID')}
        </span>
      </div>

      {data.customer_id && data.customer_name && (
        <Card className="p-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Customer</h2>
          <DrilldownLink entity="customer" id={data.customer_id} label={data.customer_name} />
        </Card>
      )}

      {data.served_by_name && (
        <Card className="p-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Served by</h2>
          <DrilldownLink entity="user" id={data.served_by ?? ''} label={data.served_by_name} icon={false} />
        </Card>
      )}

      <Card className="p-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Items</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2">Product</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Unit</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id} className={`border-t ${it.is_cancelled ? 'line-through opacity-50' : ''}`}>
                <td className="py-2">
                  <DrilldownLink
                    entity="product"
                    id={it.product_id}
                    label={it.name_snapshot}
                    icon={false}
                  />
                </td>
                <td className="text-right">{it.quantity}</td>
                <td className="text-right">{fmtIdr(it.unit_price)}</td>
                <td className="text-right">{fmtIdr(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Payments</h2>
        {data.payments.length === 0 ? (
          <div className="text-sm text-muted-foreground">Not paid yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2">Method</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2 text-right">Cash received</th>
                <th className="pb-2 text-right">Change</th>
                <th className="pb-2">Paid at</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-2">{p.method}</td>
                  <td className="text-right">{fmtIdr(p.amount)}</td>
                  <td className="text-right">{p.cash_received != null ? fmtIdr(p.cash_received) : '—'}</td>
                  <td className="text-right">{p.change_given != null ? fmtIdr(p.change_given) : '—'}</td>
                  <td>{new Date(p.paid_at).toLocaleString('id-ID')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data.refunds.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Refunds</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2">Number</th>
                <th className="pb-2 text-right">Total</th>
                <th className="pb-2">Reason</th>
                <th className="pb-2">Full void</th>
                <th className="pb-2">At</th>
              </tr>
            </thead>
            <tbody>
              {data.refunds.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2">{r.refund_number}</td>
                  <td className="text-right">{fmtIdr(r.total)}</td>
                  <td>{r.reason}</td>
                  <td>{r.is_full_void ? 'Yes' : 'Partial'}</td>
                  <td>{new Date(r.created_at).toLocaleString('id-ID')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="p-4 space-y-1 max-w-md ml-auto">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span>{fmtIdr(data.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Discount</span>
          <span>− {fmtIdr(data.discount_amount)}</span>
        </div>
        {data.promotions.map((promo, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span>{promo.description}</span>
            <span>− {fmtIdr(promo.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between text-sm">
          <span>PB1</span>
          <span>{fmtIdr(data.tax_amount)}</span>
        </div>
        <div className="flex justify-between font-semibold border-t pt-1">
          <span>Total</span>
          <span>{fmtIdr(data.total)}</span>
        </div>
      </Card>
    </div>
  );
}
