// apps/pos/src/features/reports/POSProductsReportPage.tsx
//
// Session 14 — Phase 2.D — POS Reports / Products tab.
//
// Visual ref: 83-pos-reports-products-month.jpg.
//
// Layout: TOP PRODUCTS section label + ranked list with subtle gold bar
// behind each row sized to revenue. Numeric rank chip + name + sold count.

import { type JSX } from 'react';
import { Trophy } from 'lucide-react';
import { Currency, SectionLabel, EmptyState, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import { usePOSReportsTopProducts, type POSReportsTopProduct } from './hooks/usePOSReports';
import { ReportsForbidden } from './components/ReportsForbidden';

export default function POSProductsReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.sales.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="products">
      {(period) => <ProductsList period={period} />}
    </POSReportsLayout>
  );
}

function ProductsList({
  period,
}: {
  period: { start: string; end: string; label: string };
}): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsTopProducts(period as Parameters<typeof usePOSReportsTopProducts>[0]);

  if (isLoading) return <p className="text-text-secondary text-sm">Loading top products…</p>;
  if (isError) return <p className="text-red text-sm">Failed to load top products.</p>;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No products sold"
        description="No transactions completed in this period."
      />
    );
  }

  const maxRevenue = Math.max(...data.map((p) => p.revenue), 1);

  return (
    <div className="space-y-3">
      <SectionLabel size="xs" as="h2">Top products</SectionLabel>
      <ul className="space-y-1.5">
        {data.map((p, i) => (
          <TopProductRow key={p.product_id} product={p} rank={i + 1} maxRevenue={maxRevenue} />
        ))}
      </ul>
    </div>
  );
}

function TopProductRow({
  product,
  rank,
  maxRevenue,
}: {
  product: POSReportsTopProduct;
  rank: number;
  maxRevenue: number;
}): JSX.Element {
  const widthPct = (product.revenue / maxRevenue) * 100;
  return (
    <li
      className="relative overflow-hidden rounded-md border border-border-subtle bg-bg-elevated"
      data-testid={`top-product-${product.product_id}`}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 bg-gold-soft"
        style={{ width: `${Math.max(widthPct, 4)}%` }}
      />
      <div className="relative flex items-center gap-3 px-3 py-2.5">
        <span
          className={cn(
            'h-8 w-8 inline-flex items-center justify-center rounded-md font-bold text-sm shrink-0',
            rank === 1
              ? 'bg-gold text-bg-base'
              : 'bg-bg-overlay border border-border-subtle text-text-secondary',
          )}
        >
          {rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">{product.product_name}</div>
          <div className="text-xs text-text-muted">{product.qty} sold</div>
        </div>
        <Currency amount={product.revenue} className="font-mono text-sm font-semibold" />
      </div>
    </li>
  );
}
