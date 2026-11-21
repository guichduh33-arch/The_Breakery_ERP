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
// Onglets : primitif Tabs du kit (rôles ARIA, flèches, focus) au lieu de
// boutons faits main ; l'onglet actif vit dans l'URL (`?tab=`), si bien que le
// retour depuis une commande ouverte dans l'onglet Orders y ramène (audit
// Sales 2026-11-21). Fil d'Ariane et titre se rendent dans tous les états.
//
// All data is read-only PostgREST (useCustomerDetail / useCustomerLoyaltyHistory
// / useCustomerCategoryPrices / useCustomerAnalytics). Mutations reuse the
// existing CustomerFormModal (edit) + LoyaltyAdjustModal (points).

import { lazy, Suspense, useMemo, useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Crown,
  DollarSign,
  Gift,
  Plus,
  ShoppingBag,
  SquarePen,
  Star,
  User as UserIcon,
  Wallet,
} from 'lucide-react';
import { LoyaltyBadge, Tabs, TabsContent } from '@breakery/ui';
import { Button, Card, TabsList, TabsTrigger } from '@/components/BackofficeUi.js';
import { TIERS, tierFromLifetime } from '@breakery/domain';
import { formatDate } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useHasPendingFinancial } from '@/lib/useFinancialAttempt.js';
import { CustomerAvatar } from '@/features/customers/components/CustomerAvatar.js';
import { CustomerCategoryChip } from '@/features/customers/components/CustomerCategoryChip.js';
import { useCustomerDetail } from '@/features/customers/hooks/useCustomerDetail.js';
import { useCustomerLoyaltyHistory } from '@/features/loyalty/hooks/useCustomerLoyaltyHistory.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { LoyaltyAdjustModal } from '@/features/loyalty/components/LoyaltyAdjustModal.js';
import type { CustomerListRow } from '@/features/loyalty/hooks/useLoyaltyCustomersList.js';
import { GrantStoreCreditModal } from '@/features/customers/components/GrantStoreCreditModal.js';
import { ConvertLoyaltyModal } from '@/features/customers/components/ConvertLoyaltyModal.js';
import { rp } from './customer-detail/shared.js';
import { InfoTab } from './customer-detail/InfoTab.js';
import { OrdersTab } from './customer-detail/OrdersTab.js';
import { LoyaltyTab } from './customer-detail/LoyaltyTab.js';
import { StoreCreditTab } from './customer-detail/StoreCreditTab.js';
import { PricingTab } from './customer-detail/PricingTab.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { Breadcrumb } from '@/components/Breadcrumb.js';
import { useListParams } from '@/hooks/useListParams.js';

const TAB_IDS = ['info', 'orders', 'loyalty', 'store-credit', 'analytics', 'pricing'] as const;
type TabId = (typeof TAB_IDS)[number];
function isTabId(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as readonly string[]).includes(v);
}

// Plancher serveur de la conversion : multiples de 100 points
// (ConvertLoyaltyModal, famille convert_loyalty_to_store_credit).
const CONVERT_MIN_POINTS = 100;

// Le seul consommateur de `recharts` de la fiche (443 Ko bruts / 117 Ko gzip),
// pour un onglet sur six — et jamais celui qu'on ouvre en arrivant. En `lazy`,
// le chunk n'arrive qu'au clic. Export NOMMÉ : d'où le `.then()`.
const AnalyticsTab = lazy(() =>
  import('./customer-detail/AnalyticsTab.js').then((m) => ({ default: m.AnalyticsTab })),
);

/** Attente discrète du chunk `charts` — papier pressé, animation coupée sous
 *  `motion-reduce`. Même geste que le Dashboard. */
function ChartSkeleton(): JSX.Element {
  return (
    <div
      data-testid="chart-skeleton"
      role="status"
      aria-label="Loading chart"
      className="h-44 animate-pulse rounded bg-surface-4 motion-reduce:animate-none"
    />
  );
}

export function CustomerDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUpdate = hasPermission('customers.update');
  const canAdjust = hasPermission('loyalty.adjust');
  // ADR-013 Lot 4 — avoir client (seeds _235 : MANAGER+).
  const canGrant = hasPermission('customers.store_credit.grant');
  const canConvert = hasPermission('customers.store_credit.convert');
  const pendingConversion = useHasPendingFinancial('loyalty_conversion', id ?? '');

  const { data, isLoading, error, refetch } = useCustomerDetail(id);
  const history = useCustomerLoyaltyHistory(id ?? null);

  const [params, patchParams] = useListParams();
  const tabParam = params.get('tab');
  // Un onglet inconnu dans l'URL retombe sur Info.
  const tab: TabId = isTabId(tabParam) ? tabParam : 'info';
  const setTab = (next: string): void => {
    patchParams({ tab: isTabId(next) && next !== 'info' ? next : null });
  };
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState<'add' | 'redeem' | null>(null);
  const [granting, setGranting] = useState(false);
  const [converting, setConverting] = useState(false);

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

  // Un échec (id invalide, droits, réseau) affichait « Loading… » pour
  // toujours : l'erreur se dit, avec un nouvel essai et un retour à la liste.
  // Le fil d'Ariane porte le retour vers la liste dans TOUS les états — c'est
  // lui, et non un « Back to customers » souligné, qui évite le cul-de-sac.
  const crumbs = (
    <Breadcrumb
      items={[
        { label: 'Sales' },
        { label: 'Customers', to: '/backoffice/customers' },
        ...(customer ? [{ label: customer.name }] : []),
      ]}
    />
  );

  if (error !== null && !customer) {
    return (
      <div className="flex flex-col gap-[13px]">
        {crumbs}
        <PageHeader title="Customer" />
        <QueryErrorBanner detail={error.message} onRetry={() => { void refetch(); }} data-testid="customer-detail-error">
          This customer could not be loaded.
        </QueryErrorBanner>
      </div>
    );
  }

  if (isLoading || !customer) {
    return (
      <div className="flex flex-col gap-[13px]" aria-busy="true">
        {crumbs}
        <PageHeader title="Customer" />
        <p role="status" className="text-sm text-text-secondary">Loading…</p>
      </div>
    );
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
    void qc.invalidateQueries({ queryKey: ['store-credit-history', id] });
  };

  const isActive = customer.deleted_at === null;
  const avgBasket =
    customer.total_visits > 0 ? Math.round(customer.total_spent / customer.total_visits) : 0;

  const tabs: readonly { id: TabId; label: string; icon: typeof UserIcon; count?: number }[] = [
    { id: 'info', label: 'Info', icon: UserIcon },
    { id: 'orders', label: 'Orders', icon: ShoppingBag, count: data?.orders_count ?? 0 },
    { id: 'loyalty', label: 'Loyalty', icon: Star, count: history.data?.length ?? 0 },
    { id: 'store-credit', label: 'Store credit', icon: Wallet },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'pricing', label: 'Pricing', icon: DollarSign },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      {crumbs}

      {/* Bandeau — `PageHeader` est la source UNIQUE du bandeau de page
          (DESIGN.md § Boutons : « un bandeau écrit à la main est un second
          défaut, pas une exception »). L'avatar reste à gauche du titre : il
          n'entre pas dans le composant, on le pose donc en tête de la rangée et
          le bandeau prend le reste de la largeur. */}
      <header className="flex items-center gap-4">
        <CustomerAvatar name={customer.name} />
        <PageHeader
          className="min-w-0 flex-1 items-center gap-4"
          title={customer.name}
          subtitle={
            <div className="flex flex-wrap items-center gap-2">
              <CustomerCategoryChip
                name={customer.category?.name ?? null}
                slug={customer.category?.slug ?? null}
              />
              <LoyaltyBadge tier={tier} points={customer.loyalty_points} />
              <span
                className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-data text-xs font-semibold uppercase tracking-widest ${
                  isActive ? 'bg-success-soft text-success' : 'bg-surface-4 text-text-muted'
                }`}
              >
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          }
          actions={
            canUpdate ? (
              <button type="button" onClick={() => setEditing(true)} className={TOOLBAR_BTN_PRIMARY}>
                <SquarePen className="h-3.5 w-3.5" aria-hidden /> Edit
              </button>
            ) : undefined
          }
        />
      </header>

      {/* Loyalty hero — les valeurs sont des mesures : mono display, pas de
          serif (Playfair est réservé au monogramme). L'or ne remplit rien :
          il porte le montant d'avoir, la jauge se remplit d'encre. */}
      <Card variant="default" padding="lg" className="shadow-none">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-text-subtle" aria-hidden />
          <span className="font-data text-xs font-semibold uppercase tracking-widest text-text-muted">{tierMeta.label}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-10">
          <div>
            <div className="font-data text-[26px] font-semibold leading-tight tracking-[-0.03em] text-text-primary tabular-nums">
              {customer.loyalty_points.toLocaleString('id-ID')}
            </div>
            <div className="mt-1 font-data text-xs font-semibold uppercase tracking-widest text-text-muted">Available points</div>
          </div>
          <div>
            <div className="font-data text-[26px] font-semibold leading-tight tracking-[-0.03em] text-text-primary tabular-nums">
              {customer.lifetime_points.toLocaleString('id-ID')}
            </div>
            <div className="mt-1 font-data text-xs font-semibold uppercase tracking-widest text-text-muted">Lifetime points</div>
          </div>
          <div>
            <div className="font-data text-[26px] font-semibold leading-tight tracking-[-0.03em] text-gold tabular-nums" data-testid="store-credit-balance">
              {rp(customer.store_credit_balance)}
            </div>
            <div className="mt-1 font-data text-xs font-semibold uppercase tracking-widest text-text-muted">Store credit</div>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>{nextTier ? `Next tier: ${nextTier.label}` : 'Top tier reached'}</span>
            {nextTier && <span className="font-data tabular-nums">{pointsToNext.toLocaleString('id-ID')} pts remaining</span>}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-sm bg-surface-4">
            {/* `transform: scaleX` et non une largeur animée : `transition-all`
                sur `width` fait relayouter la barre à chaque frame. Le rendu à
                l'œil est identique — la barre reste ancrée à gauche. */}
            <div
              className="h-full w-full origin-left bg-ink transition-transform motion-reduce:transition-none"
              style={{ transform: `scaleX(${tierProgress / 100})` }}
            />
          </div>
        </div>

        {(canAdjust || canGrant || canConvert) && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {canAdjust && (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => setAdjusting('add')}>
                  <Plus className="h-3.5 w-3.5 text-text-muted" aria-hidden /> Add points
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={customer.loyalty_points <= 0}
                  onClick={() => setAdjusting('redeem')}
                >
                  <Gift className="h-3.5 w-3.5 text-text-muted" aria-hidden /> Redeem points
                </Button>
              </>
            )}
            {canGrant && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setGranting(true)}
                data-testid="grant-store-credit"
              >
                <Wallet className="h-3.5 w-3.5 text-text-muted" aria-hidden /> Grant store credit
              </Button>
            )}
            {canConvert && (() => {
              // Un bouton désactivé dit pourquoi : la raison est rendue en
              // clair à côté et reliée au bouton (aria-describedby).
              const belowMin = !pendingConversion && customer.loyalty_points < CONVERT_MIN_POINTS;
              return (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={belowMin}
                    {...(belowMin ? { 'aria-describedby': 'convert-min-reason' } : {})}
                    onClick={() => setConverting(true)}
                    data-testid="convert-store-credit"
                  >
                    <Star className="h-3.5 w-3.5 text-text-muted" aria-hidden /> {pendingConversion ? 'Check pending conversion' : 'Convert points to credit'}
                  </Button>
                  {belowMin && (
                    <span id="convert-min-reason" className="text-xs text-text-muted">
                      Needs at least {CONVERT_MIN_POINTS.toLocaleString('id-ID')} points to convert.
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <KpiCard label="Visits" value={customer.total_visits.toLocaleString('id-ID')} />
        <KpiCard label="Total spent" value={rp(customer.total_spent)} />
        <KpiCard label="Average basket" value={rp(avgBasket)} />
        <KpiCard
          label="Last visit"
          value={
            customer.last_visit_at
              ? formatDate(customer.last_visit_at)
              : '—'
          }
        />
      </div>

      {/* Tabs — primitif du kit ; seul l'onglet actif monte son panneau, ce
          qui garde le chunk `recharts` de l'onglet Analytics hors du premier
          chargement. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Customer detail" className="border-b border-border-subtle">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.id} value={t.id} className="gap-2">
                <Icon className="h-4 w-4" aria-hidden />
                {t.label}
                {t.count !== undefined && (
                  <span className="font-data text-xs tabular-nums text-text-muted">({t.count})</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="info"><InfoTab customer={customer} canEdit={canUpdate} /></TabsContent>
        <TabsContent value="orders"><OrdersTab data={data} /></TabsContent>
        <TabsContent value="loyalty"><LoyaltyTab customerId={id ?? null} /></TabsContent>
        <TabsContent value="store-credit"><StoreCreditTab customerId={id ?? null} /></TabsContent>
        <TabsContent value="analytics">
          <Suspense fallback={<ChartSkeleton />}>
            <AnalyticsTab customerId={id ?? null} />
          </Suspense>
        </TabsContent>
        <TabsContent value="pricing"><PricingTab customer={customer} /></TabsContent>
      </Tabs>

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
        customer={adjusting !== null ? modalRow : undefined}
        {...(adjusting !== null ? { direction: adjusting } : {})}
        onClose={() => {
          setAdjusting(null);
          refreshCustomer();
        }}
      />
      <GrantStoreCreditModal
        open={granting}
        customerId={customer.id}
        customerName={customer.name}
        onClose={() => {
          setGranting(false);
          refreshCustomer();
        }}
      />
      <ConvertLoyaltyModal
        open={converting}
        customerId={customer.id}
        customerName={customer.name}
        loyaltyPoints={customer.loyalty_points}
        onClose={() => {
          setConverting(false);
          refreshCustomer();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ KPI card */

// Sans pastille d'icône — même décision que la bande de KPI du dashboard :
// une frise d'icônes décoratives détourne l'œil du chiffre.
function KpiCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <Card variant="default" padding="none" className="flex flex-col gap-[5px] px-[15px] py-[13px] shadow-none">
      <div className="font-data text-xs font-semibold uppercase tracking-widest text-text-muted">{label}</div>
      <div className="font-data text-[23px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-text-primary">{value}</div>
    </Card>
  );
}
