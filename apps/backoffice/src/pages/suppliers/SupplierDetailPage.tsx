// apps/backoffice/src/pages/suppliers/SupplierDetailPage.tsx
//
// Session 14 / Phase 5.A — Supplier detail surface.
// Composition mirrors `15b…15e` screenshots:
//   - Back link + identity card (logo + name + status, contact info column,
//     and a 2x2 KPI tile cluster on the right).
//   - Tabs: Purchases / Price Evolution / Payments / Analytics.
//
// Write paths (Edit / Deactivate / Add Payment) reuse the existing
// SupplierFormModal + useUpdateSupplier mutation. The Payments tab stays
// read-only (payments are recorded on the PO page).
// S3-07 — l'impayé et le payé viennent du grand livre `purchase_payments`
// (`useSupplierOutstanding`), selon la règle du rapport des paiements
// fournisseurs ; le badge par bon aussi (`PoPaymentBadge`, commun aux achats).
//
// Price Evolution + Analytics also stay read-only — these surfaces require
// dedicated reporting RPCs (e.g. `mv_supplier_price_history`, `mv_supplier_
// monthly_volume`) that have not landed yet. We render explanatory empty
// states there so the tab stack is consistent.

import { lazy, Suspense, useState, type JSX, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarClock,
  Clock,
  CreditCard,
  DollarSign,
  LineChart,
  Package,
  Pencil,
  Phone,
  Receipt,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { Badge, Tabs, TabsContent } from '@breakery/ui';
import { Button, Card, EmptyState, KpiTile, TabsList, TabsTrigger } from '@/components/BackofficeUi.js';
import { formatCurrency, formatNumber } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { PAGE_TITLE_CLS } from '@/components/PageHeader.js';
import { useSupplierDetail } from '@/features/suppliers/hooks/useSupplierDetail.js';
import { useSupplierPurchases } from '@/features/suppliers/hooks/useSupplierPurchases.js';
import { useSupplierMetrics } from '@/features/suppliers/hooks/useSupplierMetrics.js';
import { useSupplierOutstanding } from '@/features/suppliers/hooks/useSupplierOutstanding.js';
import { SupplierPurchasesTab } from '@/features/suppliers/components/SupplierPurchasesTab.js';
import { SupplierPaymentsSection } from '@/features/suppliers/components/SupplierPaymentsSection.js';
import { SupplierGroupPaymentAction } from '@/features/suppliers/components/SupplierGroupPaymentDialog.js';
import { useSupplierPurchaseItems } from '@/features/suppliers/hooks/useSupplierPurchaseItems.js';
import { useUpdateSupplier } from '@/features/suppliers/hooks/useUpdateSupplier.js';
import { SupplierFormModal } from '@/features/suppliers/components/SupplierFormModal.js';
import type { SupplierRow } from '@/features/suppliers/hooks/useSuppliersList.js';

// Les trois seuls consommateurs de `recharts` de cette fiche (443 Ko bruts /
// 117 Ko gzip). Statiques, ils partaient dans le chargement de la page alors que
// l'onglet ouvert par défaut est « Purchases » — un tableau. En `lazy`, le chunk
// n'arrive qu'au clic sur l'onglet qui en a besoin, Radix ne montant pas le
// contenu d'un onglet inactif. Exports NOMMÉS : d'où le `.then()` qui les remet
// en `default`.
const SupplierAnalyticsTab = lazy(() =>
  import('@/features/suppliers/components/SupplierAnalyticsTab.js')
    .then((m) => ({ default: m.SupplierAnalyticsTab })),
);
const SupplierPriceEvolutionTab = lazy(() =>
  import('@/features/suppliers/components/SupplierPriceEvolutionTab.js')
    .then((m) => ({ default: m.SupplierPriceEvolutionTab })),
);

/** Attente discrète du chunk `charts` — même geste que le Dashboard : papier
 *  pressé plutôt que blanc sur blanc, animation coupée sous `motion-reduce`. */
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

function StatusBadge({ active }: { active: boolean }): JSX.Element {
  return active ? (
    <Badge variant="default" className="border-success bg-success-soft text-success">Active</Badge>
  ) : (
    <Badge variant="outline" className="text-text-muted">Inactive</Badge>
  );
}

function fmtIdrPrefixed(amount: number): string {
  // formatCurrency already prefixes "Rp ".
  return formatCurrency(amount);
}

/** Montant issu du grand livre : « … » tant qu'il charge, « — » en erreur. */
function fmtLedger(amount: number | undefined, isError: boolean): string {
  if (isError) return '—';
  if (amount === undefined) return '…';
  return fmtIdrPrefixed(amount);
}

function fmtDays(days: number): string {
  if (!Number.isFinite(days)) return '—';
  return `${formatNumber(days, { digits: 1 })} days`;
}

export default function SupplierDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('suppliers.read');
  const canUpdate = hasPermission('suppliers.update');

  const detail    = useSupplierDetail(id);
  const purchases = useSupplierPurchases(id);
  const items     = useSupplierPurchaseItems(id);
  const updateMut = useUpdateSupplier();
  const metrics   = useSupplierMetrics(purchases.data ?? []);
  const ledger    = useSupplierOutstanding(id);

  const [editing, setEditing] = useState<SupplierRow | undefined>(undefined);
  const [tab, setTab] = useState<'purchases' | 'price' | 'payments' | 'analytics'>('purchases');

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view this supplier.</div>;
  }
  if (detail.isLoading) {
    return <div className="text-text-secondary">Loading…</div>;
  }
  if (detail.error !== null && detail.error !== undefined) {
    return <div className="text-danger">Failed to load supplier: {detail.error.message}</div>;
  }
  const supplier = detail.data;
  if (supplier === null || supplier === undefined) {
    return (
      <div className="space-y-4">
        <Link to="/backoffice/suppliers" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to suppliers
        </Link>
        <EmptyState
          icon={Building2}
          title="Supplier not found"
          description="This supplier may have been deleted or you do not have access."
          size="md"
        />
      </div>
    );
  }

  function handleToggleActive(): void {
    if (supplier === null || supplier === undefined) return;
    updateMut.mutate({ id: supplier.id, values: { is_active: !supplier.is_active } });
  }

  const purchaseRows = purchases.data ?? [];

  return (
    <div className="space-y-6">
      <Link
        to="/backoffice/suppliers"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to Suppliers
      </Link>

      <Card variant="default" padding="md">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-gold">
                  <Building2 className="h-6 w-6" />
                </span>
                <div>
                  <h1 className={PAGE_TITLE_CLS}>{supplier.name}</h1>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-xs uppercase text-text-muted">{supplier.code}</span>
                    <StatusBadge active={supplier.is_active} />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {canUpdate && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(supplier)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleToggleActive}
                      disabled={updateMut.isPending}
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden />
                      {supplier.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
              {supplier.address !== null && supplier.address !== '' && (
                <DetailRow icon={Building2} label="Address" value={supplier.address} />
              )}
              {supplier.contact_phone !== null && supplier.contact_phone !== '' && (
                <DetailRow icon={Phone} label="Phone" value={supplier.contact_phone} />
              )}
              {supplier.contact_email !== null && supplier.contact_email !== '' && (
                <DetailRow icon={Receipt} label="Email" value={supplier.contact_email} />
              )}
              <DetailRow
                icon={CalendarClock}
                label="Payment terms"
                value={supplier.payment_terms_days === 0 ? 'Cash on delivery' : `Net ${supplier.payment_terms_days} days`}
              />
              {supplier.notes !== null && supplier.notes !== '' && (
                <DetailRow icon={LineChart} label="Notes" value={supplier.notes} />
              )}
            </dl>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Total Spent" value={fmtIdrPrefixed(metrics.totalSpent)} icon={DollarSign} />
            <KpiTile label="Purchase Orders" value={metrics.poCount} icon={Package} />
            <KpiTile label="Unpaid Amount" value={fmtLedger(ledger.data?.outstanding, ledger.isError)} icon={CreditCard} />
            <KpiTile label="Avg Delivery" value={fmtDays(metrics.avgLeadDays)} icon={Clock} />
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="purchases">
            <Package className="h-4 w-4" aria-hidden /> Purchases
          </TabsTrigger>
          <TabsTrigger value="price">
            <TrendingUp className="h-4 w-4" aria-hidden /> Price Evolution
          </TabsTrigger>
          <TabsTrigger value="payments">
            <CreditCard className="h-4 w-4" aria-hidden /> Payments
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="h-4 w-4" aria-hidden /> Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="purchases" className="mt-4">
          {purchases.error !== null && purchases.error !== undefined ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
              Failed to load purchases: {purchases.error.message}
            </div>
          ) : (
            <SupplierPurchasesTab rows={purchaseRows} isLoading={purchases.isLoading} />
          )}
        </TabsContent>

        <TabsContent value="price" className="mt-4">
          <Suspense fallback={<ChartSkeleton />}>
            <SupplierPriceEvolutionTab items={items.data ?? []} />
          </Suspense>
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          {!purchases.isLoading && (
            <div className="mb-4 flex justify-end">
              <SupplierGroupPaymentAction supplierId={id ?? ''} supplierName={supplier.name} rows={purchaseRows} />
            </div>
          )}
          <SupplierPaymentsSection rows={purchaseRows} ledger={ledger} isLoading={purchases.isLoading} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <Suspense fallback={<ChartSkeleton />}>
            <SupplierAnalyticsTab
              items={items.data ?? []}
              spendByPo={purchaseRows.map((r) => ({ order_date: r.order_date, total_amount: Number(r.total_amount ?? 0) }))}
            />
          </Suspense>
        </TabsContent>
      </Tabs>

      {editing !== undefined && (
        <SupplierFormModal
          open
          mode="edit"
          initial={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: ReactNode;
}): JSX.Element {
  return (
    <div className="min-w-0 py-1">
      <dt className="flex items-center gap-2 text-sm font-medium text-text-secondary">
        <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 pl-5 text-sm text-text-primary break-words">{value}</dd>
    </div>
  );
}
