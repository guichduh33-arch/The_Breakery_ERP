// apps/backoffice/src/pages/customers/CustomerDetailPage.tsx
//
// Rich customer profile page (rebuilt) — reachable from the Customers list by
// clicking a row. Mirrors the reference design:
//   - header : back, avatar, name, category + tier + active badges, Edit
//   - loyalty hero : tier, available / lifetime points, next-tier progress,
//     Add points / Redeem points
//   - 4 KPI cards : Visits / Total Spent / Average Basket / Last Visit
//   - tabs : Info · Orders · Loyalty · Analytics · Pricing
//
// All data is read-only PostgREST (useCustomerDetail / useCustomerLoyaltyHistory
// / useCustomerCategoryPrices / useCustomerAnalytics). Mutations reuse the
// existing CustomerFormModal (edit) + LoyaltyAdjustModal (points).

import { useMemo, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  CreditCard,
  Crown,
  DollarSign,
  Gift,
  Mail,
  Phone,
  Plus,
  ShoppingBag,
  SquarePen,
  Star,
  TrendingUp,
  User as UserIcon,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, Card, LoyaltyBadge } from '@breakery/ui';
import { TIERS, tierFromLifetime } from '@breakery/domain';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { CustomerAvatar } from '@/features/customers/components/CustomerAvatar.js';
import { CustomerCategoryChip } from '@/features/customers/components/CustomerCategoryChip.js';
import {
  useCustomerDetail,
  type CustomerDetailRow,
  type PriceModifierType,
} from '@/features/customers/hooks/useCustomerDetail.js';
import { useCustomerLoyaltyHistory } from '@/features/loyalty/hooks/useCustomerLoyaltyHistory.js';
import { useCustomerCategoryPrices } from '@/features/customers/hooks/useCustomerCategoryPrices.js';
import { useCustomerAnalytics } from '@/features/customers/hooks/useCustomerAnalytics.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { LoyaltyAdjustModal } from '@/features/loyalty/components/LoyaltyAdjustModal.js';
import type { CustomerListRow } from '@/features/loyalty/hooks/useLoyaltyCustomersList.js';

type TabId = 'info' | 'orders' | 'loyalty' | 'analytics' | 'pricing';

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: 'Dine In',
  take_out: 'Take Out',
  delivery: 'Delivery',
  b2b: 'B2B',
};

const MODIFIER_LABEL: Record<PriceModifierType, string> = {
  retail: 'Retail price',
  wholesale: 'Wholesale price',
  discount_percentage: 'Percentage discount',
  custom: 'Custom price list',
};

function rp(amount: number | string | null): string {
  return formatIdr(Number(amount ?? 0));
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const tone =
    status === 'completed' || status === 'paid'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'voided'
        ? 'bg-rose-100 text-rose-700'
        : status === 'pending_payment' || status === 'b2b_pending'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}

export function CustomerDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUpdate = hasPermission('customers.update');
  const canAdjust = hasPermission('loyalty.adjust');

  const { data, isLoading } = useCustomerDetail(id);
  const history = useCustomerLoyaltyHistory(id ?? null);

  const [tab, setTab] = useState<TabId>('info');
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const customer = data?.customer;

  const tier = useMemo(
    () => (customer ? tierFromLifetime(customer.lifetime_points) : 'bronze'),
    [customer],
  );
  const tierMeta = TIERS.find((t) => t.tier === tier) ?? TIERS[0];
  const nextTier = TIERS.find((t) => t.min > (customer?.lifetime_points ?? 0)) ?? null;
  const pointsToNext = nextTier
    ? Math.max(0, nextTier.min - (customer?.lifetime_points ?? 0))
    : 0;
  const tierProgress = nextTier
    ? Math.min(
        100,
        Math.round(
          (((customer?.lifetime_points ?? 0) - tierMeta.min) /
            (nextTier.min - tierMeta.min)) *
            100,
        ),
      )
    : 100;

  if (isLoading || !customer) {
    return <div className="p-8 text-text-secondary">Loading…</div>;
  }

  // Object shaped for the reused loyalty/edit modals.
  const modalRow: CustomerListRow = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    loyalty_points: customer.loyalty_points,
    lifetime_points: customer.lifetime_points,
    total_spent: customer.total_spent,
    total_visits: customer.total_visits,
    last_visit_at: customer.last_visit_at,
    created_at: customer.created_at,
  };

  const refreshCustomer = (): void => {
    void qc.invalidateQueries({ queryKey: ['customer-detail', id] });
    void qc.invalidateQueries({ queryKey: ['loyalty-history', id] });
  };

  const isActive = customer.deleted_at === null;
  const avgBasket =
    customer.total_visits > 0 ? Math.round(customer.total_spent / customer.total_visits) : 0;

  const tabs: ReadonlyArray<{ id: TabId; label: string; icon: typeof UserIcon; count?: number }> = [
    { id: 'info', label: 'Info', icon: UserIcon },
    { id: 'orders', label: 'Orders', icon: ShoppingBag, count: data?.orders_count ?? 0 },
    { id: 'loyalty', label: 'Loyalty', icon: Star, count: history.data?.length ?? 0 },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'pricing', label: 'Pricing', icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-text-secondary" aria-label="Breadcrumb">
        <Link to="/backoffice/customers" className="hover:text-text-primary">Customers</Link>
        <span aria-hidden>›</span>
        <span className="text-text-primary">{customer.name}</span>
      </nav>

      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild aria-label="Back to customers">
            <Link to="/backoffice/customers"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <CustomerAvatar name={customer.name} />
          <div className="leading-tight">
            <h1 className="font-serif text-3xl text-text-primary">{customer.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CustomerCategoryChip
                name={customer.category?.name ?? null}
                slug={customer.category?.slug ?? null}
              />
              <LoyaltyBadge tier={tier} points={customer.loyalty_points} />
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
        {canUpdate && (
          <Button variant="primary" size="md" onClick={() => setEditing(true)}>
            <SquarePen className="h-4 w-4" aria-hidden /> Edit
          </Button>
        )}
      </header>

      {/* Loyalty hero */}
      <Card variant="default" padding="lg" className="bg-bg-overlay/40">
        <div className="flex items-center gap-2 text-text-secondary">
          <Crown className="h-5 w-5" aria-hidden />
          <span className="text-sm font-semibold uppercase tracking-widest">{tierMeta.label}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-10">
          <div>
            <div className="font-serif text-4xl text-text-primary tabular-nums">
              {customer.loyalty_points.toLocaleString()}
            </div>
            <div className="text-xs uppercase tracking-widest text-text-secondary">Available points</div>
          </div>
          <div>
            <div className="font-serif text-4xl text-text-primary tabular-nums">
              {customer.lifetime_points.toLocaleString()}
            </div>
            <div className="text-xs uppercase tracking-widest text-text-secondary">Lifetime points</div>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>{nextTier ? `Next tier: ${nextTier.label}` : 'Top tier reached'}</span>
            {nextTier && <span className="tabular-nums">{pointsToNext.toLocaleString()} pts remaining</span>}
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-bg-base">
            <div
              className="h-full rounded-full bg-gold transition-all"
              style={{ width: `${tierProgress}%` }}
            />
          </div>
        </div>

        {canAdjust && (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button variant="secondary" size="lg" onClick={() => setAdjusting(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Add points
            </Button>
            <Button
              variant="ghost"
              size="lg"
              disabled={customer.loyalty_points <= 0}
              onClick={() => setAdjusting(true)}
            >
              <Gift className="h-4 w-4" aria-hidden /> Redeem points
            </Button>
          </div>
        )}
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ShoppingBag} label="Visits" value={customer.total_visits.toLocaleString()} />
        <KpiCard icon={TrendingUp} label="Total spent" value={rp(customer.total_spent)} />
        <KpiCard icon={CreditCard} label="Average basket" value={rp(avgBasket)} />
        <KpiCard
          icon={Calendar}
          label="Last visit"
          value={
            customer.last_visit_at
              ? new Date(customer.last_visit_at).toLocaleDateString('id-ID')
              : '—'
          }
        />
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Customer detail" className="flex flex-wrap gap-1 border-b border-border-subtle">
        {tabs.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={[
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-gold text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t.label}
              {t.count !== undefined && (
                <span className="text-xs text-text-muted">({t.count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      {tab === 'info' && <InfoTab customer={customer} />}
      {tab === 'orders' && <OrdersTab data={data!} />}
      {tab === 'loyalty' && <LoyaltyTab customerId={id ?? null} />}
      {tab === 'analytics' && <AnalyticsTab customerId={id ?? null} />}
      {tab === 'pricing' && <PricingTab customer={customer} />}

      {/* Modals */}
      <CustomerFormModal
        open={editing}
        mode="edit"
        initial={modalRow}
        onClose={() => {
          setEditing(false);
          refreshCustomer();
        }}
      />
      <LoyaltyAdjustModal
        customer={adjusting ? modalRow : undefined}
        onClose={() => {
          setAdjusting(false);
          refreshCustomer();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ KPI card */

function KpiCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserIcon;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <Card variant="default" padding="md">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-overlay text-gold">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="leading-tight">
          <div className="text-lg font-semibold text-text-primary tabular-nums">{value}</div>
          <div className="text-xs uppercase tracking-widest text-text-secondary">{label}</div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- Info tab */

function InfoTab({ customer }: { customer: CustomerDetailRow }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card variant="default" padding="md" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">Contact</h2>
        {customer.email && (
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <Mail className="h-4 w-4 text-text-muted" aria-hidden /> {customer.email}
          </div>
        )}
        {customer.phone && (
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <Phone className="h-4 w-4 text-text-muted" aria-hidden /> {customer.phone}
          </div>
        )}
        {!customer.email && !customer.phone && (
          <p className="text-sm text-text-muted">No contact on file.</p>
        )}
        <div className="pt-2 text-xs text-text-muted">
          Customer since {new Date(customer.created_at).toLocaleDateString('id-ID')}
          {customer.birth_date && ` · Birthday ${new Date(customer.birth_date).toLocaleDateString('id-ID')}`}
        </div>
      </Card>

      {customer.customer_type === 'b2b' && (
        <Card variant="default" padding="md" className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">B2B account</h2>
          {customer.b2b_company_name && (
            <div className="text-sm text-text-primary">Company: <strong>{customer.b2b_company_name}</strong></div>
          )}
          {customer.b2b_tax_id && (
            <div className="text-sm text-text-primary">Tax ID (NPWP): {customer.b2b_tax_id}</div>
          )}
          <div className="text-sm text-text-primary">Credit limit: <strong>{rp(customer.b2b_credit_limit)}</strong></div>
          <div className="text-sm text-text-primary">Current balance: <strong>{rp(customer.b2b_current_balance)}</strong></div>
          {customer.b2b_payment_terms_days != null && (
            <div className="text-xs text-text-muted">Payment terms: {customer.b2b_payment_terms_days} days net</div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Orders tab */

function OrdersTab({
  data,
}: {
  data: NonNullable<ReturnType<typeof useCustomerDetail>['data']>;
}): JSX.Element {
  const { recent_orders, orders_count } = data;
  const totalShown = recent_orders.reduce((s, o) => s + o.total, 0);

  if (recent_orders.length === 0) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">No orders yet.</p></Card>;
  }

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 text-xs text-text-secondary">
        <span>Showing {recent_orders.length} of {orders_count} orders</span>
        <span className="tabular-nums">{rp(totalShown)}</span>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead className="border-y border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Date</th>
            <th className="px-4 py-2.5 text-left font-medium">Order #</th>
            <th className="px-4 py-2.5 text-left font-medium">Type</th>
            <th className="px-4 py-2.5 text-left font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Items</th>
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {recent_orders.map((o) => (
            <tr key={o.id} className="border-t border-border-subtle hover:bg-bg-overlay/40">
              <td className="px-4 py-3 text-text-secondary">{new Date(o.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td className="px-4 py-3 font-mono text-text-primary">
                <Link to={`/backoffice/orders/${o.id}`} className="hover:text-gold">{o.order_number}</Link>
              </td>
              <td className="px-4 py-3 text-text-secondary">{ORDER_TYPE_LABEL[o.order_type] ?? o.order_type}</td>
              <td className="px-4 py-3"><StatusPill status={o.status} /></td>
              <td className="px-4 py-3 text-right tabular-nums">{o.items_count}</td>
              <td className="px-4 py-3 text-right tabular-nums font-medium">{rp(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ---------------------------------------------------------------- Loyalty tab */

const TXN_TONE: Record<string, string> = {
  earn: 'text-emerald-600',
  refund: 'text-emerald-600',
  redeem: 'text-rose-600',
  adjust: 'text-amber-600',
};

function LoyaltyTab({ customerId }: { customerId: string | null }): JSX.Element {
  const { data, isLoading } = useCustomerLoyaltyHistory(customerId);

  if (isLoading) return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">Loading…</p></Card>;
  if (!data || data.length === 0) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">No loyalty activity yet.</p></Card>;
  }

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead className="border-b border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Date</th>
            <th className="px-4 py-2.5 text-left font-medium">Type</th>
            <th className="px-4 py-2.5 text-left font-medium">Description</th>
            <th className="px-4 py-2.5 text-right font-medium">Points</th>
            <th className="px-4 py-2.5 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {data.map((tx) => (
            <tr key={tx.id} className="border-t border-border-subtle">
              <td className="px-4 py-3 text-text-secondary">{new Date(tx.created_at).toLocaleDateString('id-ID')}</td>
              <td className={`px-4 py-3 font-medium capitalize ${TXN_TONE[tx.transaction_type] ?? 'text-text-primary'}`}>{tx.transaction_type}</td>
              <td className="px-4 py-3 text-text-secondary">{tx.description}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-medium ${tx.points >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {tx.points >= 0 ? '+' : ''}{tx.points.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{tx.points_balance_after.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* -------------------------------------------------------------- Analytics tab */

function AnalyticsTab({ customerId }: { customerId: string | null }): JSX.Element {
  const { data, isLoading } = useCustomerAnalytics(customerId);

  if (isLoading) return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">Loading…</p></Card>;
  if (!data || data.ordersConsidered === 0) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">Not enough purchase history to show analytics.</p></Card>;
  }

  const typeTotal = data.byType.reduce((s, t) => s + t.orders, 0);

  return (
    <div className="space-y-4">
      <Card variant="default" padding="md">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-text-secondary">Spend — last 12 months</h2>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthly} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} width={40} />
              <Tooltip
                formatter={(v: number) => [rp(v), 'Spend']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="total" fill="var(--gold-base, #c8a874)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card variant="default" padding="md">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-text-secondary">Order type</h2>
          <div className="space-y-3">
            {data.byType.map((t) => (
              <div key={t.type}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{t.label}</span>
                  <span className="tabular-nums text-text-secondary">{t.orders} · {rp(t.total)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
                  <div className="h-full rounded-full bg-gold" style={{ width: `${typeTotal > 0 ? (t.orders / typeTotal) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="default" padding="md">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-text-secondary">Top products</h2>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-text-muted">No items.</p>
          ) : (
            <ul className="space-y-2">
              {data.topProducts.map((p) => (
                <li key={p.product_id} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{p.name}</span>
                  <span className="tabular-nums text-text-secondary">×{p.quantity} · {rp(p.spend)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Pricing tab */

function PricingTab({ customer }: { customer: CustomerDetailRow }): JSX.Element {
  const category = customer.category;
  const { data: overrides, isLoading } = useCustomerCategoryPrices(
    category?.price_modifier_type === 'custom' ? category.id : null,
  );

  if (!category) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">No category assigned — this customer pays standard retail prices.</p></Card>;
  }

  const modifier = category.price_modifier_type;

  return (
    <div className="space-y-4">
      <Card variant="default" padding="md" className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">Pricing rule</h2>
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <CustomerCategoryChip name={category.name} slug={category.slug} />
          <span>→ {MODIFIER_LABEL[modifier]}</span>
        </div>
        {modifier === 'discount_percentage' && (
          <p className="text-sm text-text-secondary">
            {category.discount_percentage}% off retail on every product.
          </p>
        )}
        {modifier === 'wholesale' && (
          <p className="text-sm text-text-secondary">Wholesale price where defined, otherwise retail.</p>
        )}
        {modifier === 'retail' && (
          <p className="text-sm text-text-secondary">Standard retail pricing — no category discount.</p>
        )}
        <p className="pt-1 text-xs text-text-muted">
          Loyalty multiplier ×{category.points_multiplier} · loyalty {category.loyalty_enabled ? 'enabled' : 'disabled'}
        </p>
      </Card>

      {modifier === 'custom' && (
        <Card variant="default" padding="none" className="overflow-hidden">
          <div className="px-4 py-3 text-xs text-text-secondary">
            {isLoading ? 'Loading overrides…' : `${overrides?.length ?? 0} custom product price(s)`}
          </div>
          {overrides && overrides.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <thead className="border-y border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Product</th>
                  <th className="px-4 py-2.5 text-right font-medium">Retail</th>
                  <th className="px-4 py-2.5 text-right font-medium">Custom</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.product_id} className="border-t border-border-subtle">
                    <td className="px-4 py-3 text-text-primary">
                      {o.product_name}
                      {o.product_sku && <span className="ml-2 text-xs text-text-muted">{o.product_sku}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted line-through">{rp(o.retail_price)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">{rp(o.custom_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
