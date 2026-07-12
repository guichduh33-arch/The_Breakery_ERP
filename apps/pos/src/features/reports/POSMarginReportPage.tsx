// Reports POS refonte — dernier lot — POS Reports / Margin tab.
//
// Marge brute sur le WAC COURANT (products.cost_price) — PAS un coût figé à la
// vente (snapshot COGS = Vague 3) : caveat permanent affiché. Périmètre ≡
// Overview (revenue_ttc réconcilie exactement) ; cadeaux-promo comptés en COGS
// avec revenue 0 ; badge d'alerte si des produits vendus n'ont pas de coût.
// Source serveur unique : get_pos_margin_v1, gaté reports.financial.read
// (PAS reports.sales.read — les coûts ne sont pas pour tout lecteur de ventes).

import { type JSX } from 'react';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import { Currency, SectionLabel, EmptyState, Button, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import {
  usePOSReportsMargin,
  type POSReportsMargin,
  type POSReportsMarginProductRow,
  type POSReportsMarginCategoryRow,
} from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

export default function POSMarginReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.financial.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="margin">
      {(period) => <MarginReport period={period} />}
    </POSReportsLayout>
  );
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(period: ReportsPeriod, data: POSReportsMargin): void {
  const lines: string[] = ['section,label,qty,revenue_ht,cogs,margin,margin_pct'];
  for (const p of data.byProduct) {
    lines.push(
      `product,${csvEscape(p.productName)},${p.qty},${p.revenueHt},${p.cogs},${p.margin},${p.marginPct}`,
    );
  }
  for (const c of data.byCategory) {
    lines.push(
      `category,${csvEscape(c.categoryName)},${c.qty},${c.revenueHt},${c.cogs},${c.margin},${c.marginPct}`,
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pos-margin_${period.startDate}_${period.endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function MarginReport({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsMargin(period);

  if (isLoading) return <p className="text-text-secondary text-sm">Loading margin…</p>;
  if (isError || !data) return <p className="text-red text-sm">Failed to load margin.</p>;

  const s = data.summary;
  const hasLines = data.byProduct.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-muted">{data.timezone}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadCsv(period, data)}
          data-testid="pos-margin-export-csv"
        >
          Export CSV
        </Button>
      </div>

      {/* ── Permanent WAC caveat (+ no-cost badge) ─────────────────────────── */}
      <div
        className="rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3 text-xs text-text-secondary"
        data-testid="pos-margin-caveat"
      >
        COGS uses the <strong>current WAC</strong> (products.cost_price), not a cost
        frozen at sale time — historical margins shift when purchase costs change.
        {s.productsWithoutCost > 0 && (
          <span
            className="ml-2 inline-flex items-center gap-1 text-gold"
            data-testid="pos-margin-nocost-badge"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {s.productsWithoutCost} product(s) without cost — margin overstated.
          </span>
        )}
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard testId="pos-margin-kpi-revenue" label="Revenue (incl. tax)">
          <Currency amount={s.revenueTtc} emphasis="gold" />
        </KpiCard>
        <KpiCard testId="pos-margin-kpi-cogs" label="COGS (current WAC)">
          <Currency amount={s.cogs} />
        </KpiCard>
        <KpiCard testId="pos-margin-kpi-margin" label="Gross margin">
          <Currency amount={s.grossMargin} emphasis="gold" />
        </KpiCard>
        <KpiCard testId="pos-margin-kpi-pct" label="Margin %">
          <span className="text-lg font-semibold tabular-nums">{s.marginPct.toFixed(1)}%</span>
        </KpiCard>
      </div>

      {/* ── By product ─────────────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="pos-margin-products">
        <SectionLabel size="xs" as="h2">Margin by product</SectionLabel>
        {!hasLines ? (
          <EmptyState
            icon={TrendingUp}
            title="No sales"
            description="No product lines sold in this period."
          />
        ) : (
          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <ul className="divide-y divide-border-subtle">
              {data.byProduct.map((p) => (
                <ProductRow key={p.productId} row={p} />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── By category ────────────────────────────────────────────────────── */}
      {data.byCategory.length > 0 && (
        <section className="space-y-3" data-testid="pos-margin-categories">
          <SectionLabel size="xs" as="h2">Margin by category</SectionLabel>
          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <ul className="divide-y divide-border-subtle">
              {data.byCategory.map((c) => (
                <CategoryRow key={c.categoryId ?? '__uncat__'} row={c} />
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function KpiCard({
  testId,
  label,
  children,
}: {
  testId: string;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className="rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3"
      data-testid={testId}
    >
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

/** Product row: name · qty, HT revenue, COGS, margin + % with a share-style bar. */
function ProductRow({ row }: { row: POSReportsMarginProductRow }): JSX.Element {
  return (
    <li className="px-4 py-2.5" data-testid={`margin-product-${row.productId}`}>
      <MarginLine
        title={row.productName}
        subtitle={`${row.categoryName} · ${row.qty.toLocaleString()} sold`}
        revenueHt={row.revenueHt}
        cogs={row.cogs}
        margin={row.margin}
        marginPct={row.marginPct}
      />
    </li>
  );
}

function CategoryRow({ row }: { row: POSReportsMarginCategoryRow }): JSX.Element {
  return (
    <li
      className="px-4 py-2.5"
      data-testid={`margin-category-${row.categoryId ?? 'uncat'}`}
    >
      <MarginLine
        title={row.categoryName}
        subtitle={`${row.qty.toLocaleString()} sold`}
        revenueHt={row.revenueHt}
        cogs={row.cogs}
        margin={row.margin}
        marginPct={row.marginPct}
      />
    </li>
  );
}

function MarginLine({
  title,
  subtitle,
  revenueHt,
  cogs,
  margin,
  marginPct,
}: {
  title: string;
  subtitle: string;
  revenueHt: number;
  cogs: number;
  margin: number;
  marginPct: number;
}): JSX.Element {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-primary truncate">
          {title} <span className="text-text-muted">· {subtitle}</span>
        </span>
        <div className="flex items-baseline gap-3 shrink-0 text-xs text-text-muted tabular-nums">
          <span>HT <Currency amount={revenueHt} className="text-text-secondary" /></span>
          <span>COGS <Currency amount={cogs} className="text-text-secondary" /></span>
          <span className="w-12 text-right">{marginPct.toFixed(1)}%</span>
          <Currency amount={margin} className="text-sm font-semibold" />
        </div>
      </div>
      <div className={cn('mt-1.5 h-1.5 rounded-full bg-bg-overlay/60 overflow-hidden')}>
        <div
          className="h-full rounded-full bg-gold/70"
          style={{ width: `${Math.min(Math.max(marginPct, 0), 100)}%` }}
        />
      </div>
    </>
  );
}
