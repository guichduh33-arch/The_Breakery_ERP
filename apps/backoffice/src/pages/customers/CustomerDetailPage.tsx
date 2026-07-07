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
// The five tab panels live co-located under ./customer-detail/ (S57 E-D4 split)
// to keep this file under the 500-line budget. This module owns the header,
// loyalty hero, KPI row, tab bar and the reused edit/loyalty modals.
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
  Plus,
  ShoppingBag,
  SquarePen,
  Star,
  TrendingUp,
  User as UserIcon,
} from 'lucide-react';
import { Button, Card, LoyaltyBadge } from '@breakery/ui';
import { TIERS, tierFromLifetime } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { CustomerAvatar } from '@/features/customers/components/CustomerAvatar.js';
import { CustomerCategoryChip } from '@/features/customers/components/CustomerCategoryChip.js';
import { useCustomerDetail } from '@/features/customers/hooks/useCustomerDetail.js';
import { useCustomerLoyaltyHistory } from '@/features/loyalty/hooks/useCustomerLoyaltyHistory.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { LoyaltyAdjustModal } from '@/features/loyalty/components/LoyaltyAdjustModal.js';
import type { CustomerListRow } from '@/features/loyalty/hooks/useLoyaltyCustomersList.js';
import { rp } from './customer-detail/shared.js';
import { InfoTab } from './customer-detail/InfoTab.js';
import { OrdersTab } from './customer-detail/OrdersTab.js';
import { LoyaltyTab } from './customer-detail/LoyaltyTab.js';
import { AnalyticsTab } from './customer-detail/AnalyticsTab.js';
import { PricingTab } from './customer-detail/PricingTab.js';

type TabId = 'info' | 'orders' | 'loyalty' | 'analytics' | 'pricing';

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

  const tabs: readonly { id: TabId; label: string; icon: typeof UserIcon; count?: number }[] = [
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
                  isActive ? 'bg-success-soft text-success' : 'bg-bg-overlay text-text-muted'
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
      {tab === 'info' && <InfoTab customer={customer} canEdit={canUpdate} />}
      {tab === 'orders' && <OrdersTab data={data} />}
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
