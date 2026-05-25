// apps/backoffice/src/pages/customers/CustomerDetailPage.tsx
//
// Session 31 / Wave 2.A — Read-only customer detail page (no actions).
// Route-level permission gate `customers.read` (wired in routes/index.tsx).

import type { JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Mail, Phone } from 'lucide-react';
import { Card, Button } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useCustomerDetail, type CustomerType } from '@/features/customers/hooks/useCustomerDetail.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

function TypeBadge({ type }: { type: CustomerType }) {
  const cls =
    type === 'b2b'
      ? 'bg-blue-100 text-blue-800'
      : 'bg-gray-100 text-gray-800';
  const label = type === 'b2b' ? 'B2B' : 'Retail';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
  );
}

function fmtIdr(amount: number | string | null): string {
  return `Rp ${formatIdr(Number(amount ?? 0))}`;
}

export function CustomerDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useCustomerDetail(id);

  if (isLoading || !data) {
    return <div className="p-8">Loading…</div>;
  }

  const { customer, orders_count, recent_orders } = data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" asChild>
          <Link to="/backoffice/customers">
            <ArrowLeft size={16} /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold font-fraunces">{customer.name}</h1>
        <TypeBadge type={customer.customer_type} />
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Contact</h2>
        {customer.email && (
          <div className="flex items-center gap-2">
            <Mail size={14} /> {customer.email}
          </div>
        )}
        {customer.phone && (
          <div className="flex items-center gap-2">
            <Phone size={14} /> {customer.phone}
          </div>
        )}
        {!customer.email && !customer.phone && (
          <div className="text-sm text-muted-foreground">No contact on file.</div>
        )}
      </Card>

      <Card className="p-4 space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground">Activity</h2>
        <div className="text-sm">
          Lifetime spend : <strong>{fmtIdr(customer.total_spent)}</strong> · {customer.total_visits} visits
        </div>
        <div className="text-sm">
          Loyalty : <strong>{customer.loyalty_points}</strong> points (lifetime {customer.lifetime_points})
        </div>
        {customer.last_visit_at && (
          <div className="text-sm text-muted-foreground">
            Last visit : {new Date(customer.last_visit_at).toLocaleDateString('id-ID')}
          </div>
        )}
      </Card>

      {customer.customer_type === 'b2b' && (
        <Card className="p-4 space-y-1">
          <h2 className="text-sm font-medium text-muted-foreground">B2B Account</h2>
          {customer.b2b_company_name && (
            <div className="text-sm">Company : <strong>{customer.b2b_company_name}</strong></div>
          )}
          {customer.b2b_tax_id && (
            <div className="text-sm">Tax ID (NPWP) : {customer.b2b_tax_id}</div>
          )}
          <div className="text-sm">
            Credit limit : <strong>{fmtIdr(customer.b2b_credit_limit)}</strong>
          </div>
          <div className="text-sm">
            Current balance : <strong>{fmtIdr(customer.b2b_current_balance)}</strong>
          </div>
          {customer.b2b_payment_terms_days != null && (
            <div className="text-sm text-muted-foreground">
              Payment terms : {customer.b2b_payment_terms_days} days net
            </div>
          )}
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Recent orders ({orders_count} total)
        </h2>
        {recent_orders.length === 0 ? (
          <div className="text-sm text-muted-foreground">No orders yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2">Order</th>
                <th className="pb-2">Date</th>
                <th className="pb-2 text-right">Total</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {recent_orders.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="py-2">
                    <DrilldownLink entity="order" id={o.id} label={`#${o.order_number}`} icon={false} />
                  </td>
                  <td>{new Date(o.created_at).toLocaleDateString('id-ID')}</td>
                  <td className="text-right">{fmtIdr(o.total_amount)}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
