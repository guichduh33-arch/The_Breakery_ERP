// apps/pos/src/features/reports/POSMixReportPage.tsx
//
// Reports POS refonte — Lot E — POS Reports / Mix tab.
//
// Deux compositions sur le MÊME périmètre que l'Overview (donc réconciliées) :
//   * Order-type mix — dine-in / take-out / delivery : CA, commandes, panier
//     moyen, part du CA (le CA par type resomme exactement au CA Overview).
//   * Category performance — CA & quantité par catégorie produit (hors lignes
//     annulées / cadeaux promo), avec part du CA catégories.
// Source serveur unique : get_pos_order_type_category_mix_v1. Export CSV.

import { type JSX } from 'react';
import { PieChart, ShoppingBag } from 'lucide-react';
import { Currency, SectionLabel, EmptyState, Button, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import {
  usePOSReportsMix,
  type POSReportsMix,
  type POSReportsOrderTypeRow,
  type POSReportsCategoryRow,
} from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine-in',
  take_out: 'Take-out',
  delivery: 'Delivery',
  b2b: 'B2B',
};

function orderTypeLabel(code: string): string {
  return ORDER_TYPE_LABELS[code] ?? code.replace(/_/g, ' ');
}

export default function POSMixReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.sales.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="mix">
      {(period) => <MixReport period={period} />}
    </POSReportsLayout>
  );
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(period: ReportsPeriod, data: POSReportsMix): void {
  const lines: string[] = ['section,label,revenue,count_or_qty,share_pct'];
  for (const t of data.byOrderType) {
    lines.push(
      `order_type,${csvEscape(orderTypeLabel(t.orderType))},${t.revenue},${t.orderCount},${t.sharePct}`,
    );
  }
  for (const c of data.byCategory) {
    lines.push(
      `category,${csvEscape(c.categoryName)},${c.revenue},${c.qty},${c.sharePct}`,
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pos-mix_${period.startDate}_${period.endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function MixReport({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsMix(period);

  if (isLoading) return <p className="text-text-secondary text-sm">Loading mix…</p>;
  if (isError || !data) return <p className="text-red text-sm">Failed to load mix.</p>;

  const hasOrderTypes = data.byOrderType.length > 0;
  const hasCategories = data.byCategory.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-muted">{data.timezone}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadCsv(period, data)}
          data-testid="pos-mix-export-csv"
        >
          Export CSV
        </Button>
      </div>

      {/* ── Order-type mix ─────────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="pos-mix-order-types">
        <SectionLabel size="xs" as="h2">Order-type mix</SectionLabel>
        {!hasOrderTypes ? (
          <EmptyState
            icon={PieChart}
            title="No sales"
            description="No orders in this period."
          />
        ) : (
          <div className="space-y-2">
            {data.byOrderType.map((t) => (
              <OrderTypeRow key={t.orderType} row={t} />
            ))}
          </div>
        )}
      </section>

      {/* ── Category performance ───────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="pos-mix-categories">
        <SectionLabel size="xs" as="h2">Category performance</SectionLabel>
        {!hasCategories ? (
          <EmptyState
            icon={ShoppingBag}
            title="No category sales"
            description="No product lines sold in this period."
          />
        ) : (
          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <ul className="divide-y divide-border-subtle">
              {data.byCategory.map((c) => (
                <CategoryRow key={c.categoryId ?? '__uncat__'} row={c} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

/** Order-type card: label + revenue, share bar, order count · avg basket. */
function OrderTypeRow({ row }: { row: POSReportsOrderTypeRow }): JSX.Element {
  return (
    <div
      className="rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3"
      data-testid={`order-type-${row.orderType}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-text-primary">
          {orderTypeLabel(row.orderType)}
        </span>
        <Currency amount={row.revenue} emphasis="gold" />
      </div>
      <div className="mt-2 h-2 rounded-full bg-bg-overlay/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-gold"
          style={{ width: `${Math.min(row.sharePct, 100)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-text-muted">
        <span>
          {row.orderCount} order(s) · avg <Currency amount={row.avgBasket} className="text-text-secondary" />
        </span>
        <span className="tabular-nums">{row.sharePct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

/** Category row: name + qty, revenue, share bar. */
function CategoryRow({ row }: { row: POSReportsCategoryRow }): JSX.Element {
  return (
    <li className="px-4 py-2.5" data-testid={`category-${row.categoryId ?? 'uncat'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-primary truncate">
          {row.categoryName} <span className="text-text-muted">· {row.qty.toLocaleString()} sold</span>
        </span>
        <div className="flex items-baseline gap-3 shrink-0">
          <span className="text-xs text-text-muted tabular-nums w-12 text-right">
            {row.sharePct.toFixed(1)}%
          </span>
          <Currency amount={row.revenue} className="text-sm font-semibold" />
        </div>
      </div>
      <div className={cn('mt-1.5 h-1.5 rounded-full bg-bg-overlay/60 overflow-hidden')}>
        <div
          className="h-full rounded-full bg-gold/70"
          style={{ width: `${Math.min(row.sharePct, 100)}%` }}
        />
      </div>
    </li>
  );
}
