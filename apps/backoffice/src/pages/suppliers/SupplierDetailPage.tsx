// apps/backoffice/src/pages/suppliers/SupplierDetailPage.tsx
//
// Session 14 / Phase 5.A — Supplier detail surface.
// Composition mirrors `15b…15e` screenshots:
//   - Back link + identity card (logo + name + status, contact info column,
//     and a 2x2 KPI tile cluster on the right).
//   - Tabs: Purchases / Price Evolution / Payments / Analytics.
//
// Write paths (Edit / Deactivate / Add Payment) reuse the existing
// SupplierFormModal + useUpdateSupplier mutation. There is no
// `record_supplier_payment_v*` RPC in supabase/migrations as of session 14, so
// the Payments tab is intentionally read-only — supplier credit is inferred
// from PO `payment_terms` + received_date, the same logic the Suppliers KPI
// strip uses.
//
// Price Evolution + Analytics also stay read-only — these surfaces require
// dedicated reporting RPCs (e.g. `mv_supplier_price_history`, `mv_supplier_
// monthly_volume`) that have not landed yet. We render explanatory empty
// states there so the tab stack is consistent.

import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Gauge,
  LineChart,
  Package,
  Pencil,
  Phone,
  Receipt,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KpiTile,
  SectionLabel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useSupplierDetail } from '@/features/suppliers/hooks/useSupplierDetail.js';
import {
  useSupplierPurchases,
  type SupplierPOListRow,
} from '@/features/suppliers/hooks/useSupplierPurchases.js';
import { useSupplierMetrics } from '@/features/suppliers/hooks/useSupplierMetrics.js';
import { useUpdateSupplier } from '@/features/suppliers/hooks/useUpdateSupplier.js';
import { SupplierFormModal } from '@/features/suppliers/components/SupplierFormModal.js';
import type { SupplierRow } from '@/features/suppliers/hooks/useSuppliersList.js';

function StatusBadge({ active }: { active: boolean }): JSX.Element {
  return active ? (
    <Badge variant="default" className="border-success/40 bg-success/10 text-success">Active</Badge>
  ) : (
    <Badge variant="outline" className="text-text-muted">Inactive</Badge>
  );
}

function PoStatusBadge({ status }: { status: string }): JSX.Element {
  const tone =
    status === 'received'  ? 'border-success/40 bg-success/10 text-success' :
    status === 'partial'   ? 'border-warning/40 bg-warning/10 text-warning' :
    status === 'cancelled' ? 'border-danger/40  bg-danger/10  text-danger'  :
                             'border-info/40    bg-info/10    text-info';
  return <Badge variant="default" className={tone}>{status}</Badge>;
}

function PaymentBadge({ row }: { row: SupplierPOListRow }): JSX.Element {
  const isUnpaid =
    row.status !== 'cancelled' &&
    row.payment_terms === 'credit' &&
    (row.received_date === null || row.status === 'pending' || row.status === 'partial');
  return isUnpaid ? (
    <Badge variant="outline" className="border-danger/40 text-danger">unpaid</Badge>
  ) : (
    <Badge variant="outline" className="border-success/40 text-success">paid</Badge>
  );
}

function fmtIdrPrefixed(amount: number): string {
  return `Rp ${formatIdr(amount)}`;
}

function fmtDays(days: number): string {
  if (!Number.isFinite(days)) return '—';
  return `${days.toFixed(1)} days`;
}

function PurchasesTab({ rows, isLoading }: { rows: SupplierPOListRow[]; isLoading: boolean }): JSX.Element {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={`po-skel-${i}`} className="h-10 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No purchases yet"
        description="Drafted or received purchase orders will appear here."
        size="md"
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
      <table className="w-full text-sm">
        <thead className="border-b border-border-subtle bg-bg-base/40">
          <tr>
            <th className="px-4 py-3 text-left">
              <SectionLabel as="span" size="xs">Date</SectionLabel>
            </th>
            <th className="px-4 py-3 text-left">
              <SectionLabel as="span" size="xs">PO Number</SectionLabel>
            </th>
            <th className="px-4 py-3 text-left">
              <SectionLabel as="span" size="xs">Status</SectionLabel>
            </th>
            <th className="px-4 py-3 text-right">
              <SectionLabel as="span" size="xs">Items</SectionLabel>
            </th>
            <th className="px-4 py-3 text-right">
              <SectionLabel as="span" size="xs">Total</SectionLabel>
            </th>
            <th className="px-4 py-3 text-center">
              <SectionLabel as="span" size="xs">Payment</SectionLabel>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border-subtle hover:bg-bg-overlay/40">
              <td className="px-4 py-3 text-text-secondary tabular-nums">{r.order_date ?? '—'}</td>
              <td className="px-4 py-3">
                <Link to={`/backoffice/purchasing/purchase-orders/${r.id}`} className="text-gold hover:underline">
                  {r.po_number}
                </Link>
              </td>
              <td className="px-4 py-3"><PoStatusBadge status={r.status} /></td>
              <td className="px-4 py-3 text-right tabular-nums">{r.item_count}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmtIdrPrefixed(Number(r.total_amount))}</td>
              <td className="px-4 py-3 text-center"><PaymentBadge row={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SupplierDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('suppliers.read');
  const canUpdate = hasPermission('suppliers.update');

  const detail    = useSupplierDetail(id);
  const purchases = useSupplierPurchases(id);
  const updateMut = useUpdateSupplier();
  const metrics   = useSupplierMetrics(purchases.data ?? []);

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
                <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold">
                  <Building2 className="h-6 w-6" />
                </span>
                <div>
                  <h1 className="font-display text-2xl text-text-primary">{supplier.name}</h1>
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
            <KpiTile label="Unpaid Amount" value={fmtIdrPrefixed(metrics.unpaidAmount)} icon={CreditCard} />
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
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              Failed to load purchases: {purchases.error.message}
            </div>
          ) : (
            <PurchasesTab rows={purchaseRows} isLoading={purchases.isLoading} />
          )}
        </TabsContent>

        <TabsContent value="price" className="mt-4">
          <EmptyState
            icon={TrendingUp}
            title="Price evolution coming soon"
            description="A per-product unit-price chart will surface here once the supplier price history materialised view ships."
            size="md"
          />
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <PaymentsSection rows={purchaseRows} metrics={metrics} isLoading={purchases.isLoading} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <EmptyState
              icon={BarChart3}
              title="Monthly spend analytics"
              description="Volume + spend trend charts arrive once the supplier monthly aggregates view is built."
              size="md"
            />
            <EmptyState
              icon={Gauge}
              title="Top products"
              description="Per-supplier product purchase volume + average price will surface here."
              size="md"
            />
          </div>
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
    <div className="flex items-start gap-2 py-1">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
      <div className="min-w-0">
        <SectionLabel as="span" size="xs" className="mr-2">{label}</SectionLabel>
        <span className="text-sm text-text-primary">{value}</span>
      </div>
    </div>
  );
}

function PaymentsSection({
  rows,
  metrics,
  isLoading,
}: {
  rows: SupplierPOListRow[];
  metrics: ReturnType<typeof useSupplierMetrics>;
  isLoading: boolean;
}): JSX.Element {
  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />;
  }
  const overdue = useMemo(() => {
    const today = Date.now();
    return rows.reduce((acc, r) => {
      if (r.status === 'cancelled' || r.payment_terms !== 'credit' || r.received_date !== null) return acc;
      if (r.expected_date !== null && new Date(r.expected_date).getTime() < today) {
        return acc + Number(r.total_amount ?? 0);
      }
      return acc;
    }, 0);
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiTile label="Total Paid"   value={fmtIdrPrefixed(metrics.paidAmount)}   icon={CheckCircle2} />
        <KpiTile label="Total Unpaid" value={fmtIdrPrefixed(metrics.unpaidAmount)} icon={CreditCard} />
        <KpiTile label="Overdue"      value={fmtIdrPrefixed(overdue)}              icon={Clock} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No payment history"
          description="Once a credit-term PO ships, supplier-side payment status will surface here."
          size="md"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
          <table className="w-full text-sm">
            <thead className="border-b border-border-subtle bg-bg-base/40">
              <tr>
                <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">PO #</SectionLabel></th>
                <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Date</SectionLabel></th>
                <th className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Total</SectionLabel></th>
                <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Status</SectionLabel></th>
                <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Due Date</SectionLabel></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border-subtle">
                  <td className="px-4 py-3">
                    <Link to={`/backoffice/purchasing/purchase-orders/${r.id}`} className="text-gold hover:underline">
                      {r.po_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.order_date ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtIdrPrefixed(Number(r.total_amount))}</td>
                  <td className="px-4 py-3"><PaymentBadge row={r} /></td>
                  <td className="px-4 py-3 tabular-nums">{r.expected_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

