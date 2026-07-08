// apps/backoffice/src/pages/inventory/ProductStockPage.tsx
//
// Consolidated stock-management view for ONE product, reached by clicking an
// item in Stock & Inventory. Dissociated from the product configuration sheet
// (/backoffice/products/:productId), which now holds only general settings.
//
// Tabbed to keep each view light (2026-06-23):
//   - Stock       live KPIs · stock per station/section · velocity
//   - Movements   stock timeline · movement breakdown · recent movements
//   - Purchase    purchase price trend · purchase pattern · incoming POs
//   - Transfers   transfers (date · from→to · qty)
//   - Production   weekly consumption · recipe usage · production · waste · opname
//
// URL: /backoffice/inventory/:productId

import { useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarRange, Coins, Package, Settings2, TrendingUp,
} from 'lucide-react';
import { KpiTile, cn } from '@breakery/ui';
import { useProductDetail } from '@/features/products/hooks/useProductDetail.js';
import { useProductAnalytics } from '@/features/products/hooks/useProductAnalytics.js';
import {
  MovementsSection, PurchaseSection, TransfersSection, ProductionLossSection,
} from '@/features/products/components/StockAnalyticsPanel.js';
import { useProductDashboard } from '@/features/inventory-dashboard/hooks/useProductDashboard.js';
import { SalesVelocityChart } from '@/features/inventory-dashboard/components/SalesVelocityChart.js';
import { StockBySectionList } from '@/features/inventory-dashboard/components/StockBySectionList.js';

const WINDOW_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 7,  label: '7 days'  },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
];

type StockTab = 'stock' | 'movements' | 'purchase' | 'transfers' | 'production';
const TABS: readonly { id: StockTab; label: string }[] = [
  { id: 'stock',      label: 'Stock'      },
  { id: 'movements',  label: 'Movements'  },
  { id: 'purchase',   label: 'Purchase'   },
  { id: 'transfers',  label: 'Transfers'  },
  { id: 'production', label: 'Production' },
];

export default function ProductStockPage(): JSX.Element {
  const { productId } = useParams<{ productId: string }>();
  const [days, setDays] = useState<number>(30);
  const [tab, setTab]   = useState<StockTab>('stock');
  const product   = useProductDetail(productId ?? null);
  const dash      = useProductDashboard(productId ?? null, days);
  const analytics = useProductAnalytics(productId ?? null, days);

  if (product.isLoading) {
    return <div className="py-16 text-center text-sm text-text-secondary">Loading stock…</div>;
  }
  if (product.error !== null && product.error !== undefined) {
    return (
      <div role="alert" className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red">
        Failed to load product: {product.error.message}
      </div>
    );
  }
  if (product.data === null || product.data === undefined) {
    return <div className="py-16 text-center text-sm text-text-secondary">Product not found.</div>;
  }

  const p = product.data;
  const d = dash.data;
  const a = analytics.data;
  const valueAtCost = d
    ? Math.round(Number(d.product.value_at_cost) || 0)
    : Math.round(p.current_stock * p.cost_price);

  return (
    <div className="space-y-6">
      <header>
        <Link
          to="/backoffice/inventory"
          className="inline-flex items-center gap-1 text-xs text-text-secondary transition-colors duration-fast hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Back to Stock &amp; Inventory
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-text-primary">{p.name}</h1>
            <p className="mt-0.5 font-mono text-xs text-text-muted">{p.sku}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={`/backoffice/products/${p.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden /> Product settings
            </Link>
            <div className="flex items-center gap-2">
              <label htmlFor="stock-days" className="text-xs uppercase tracking-widest text-text-secondary">
                Window
              </label>
              <select
                id="stock-days"
                value={days}
                onChange={(e) => { setDays(Number(e.target.value)); }}
                className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
              >
                {WINDOW_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Live stock KPIs — always visible above the tabs */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Stock KPIs">
        <KpiTile
          label="Current stock"
          value={p.track_inventory || p.is_display_item ? `${Number(p.current_stock)} ${p.unit}` : 'Non suivi'}
          icon={Package}
        />
        <KpiTile label="Value at cost" value={valueAtCost} valueFormat="currency" icon={Coins} />
        <KpiTile
          label="Units sold"
          value={d ? Number(d.summary.units_sold) : 0}
          icon={TrendingUp}
          footer={`${days}-day window`}
        />
        <KpiTile
          label="Avg per day"
          value={d ? Number(Number(d.summary.avg_daily_units).toFixed(2)) : 0}
          icon={CalendarRange}
        />
      </section>

      {/* Tab strip */}
      <div className="border-b border-border-subtle">
        <nav role="tablist" aria-label="Product stock sections" className="flex flex-wrap gap-x-6">
          {TABS.map((t) => {
            const selected = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => { setTab(t.id); }}
                className={cn(
                  'relative -mb-px py-3 text-xs font-semibold uppercase tracking-widest transition-colors duration-fast',
                  selected ? 'text-gold' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {t.label}
                {selected && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-gold" />}
              </button>
            );
          })}
        </nav>
      </div>

      <div data-testid={`stock-tab-${tab}`}>
        {tab === 'stock' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {dash.isLoading ? (
                <div className="rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm text-text-secondary">
                  Loading sections…
                </div>
              ) : (
                <StockBySectionList rows={d?.stock_by_section ?? []} />
              )}
            </div>

            {d !== null && d !== undefined && (
              <SalesVelocityChart data={d.sales_velocity_daily} unit={p.unit} />
            )}
          </div>
        )}

        {tab !== 'stock' && (
          <AnalyticsTab
            tab={tab}
            isLoading={analytics.isLoading}
            error={analytics.error}
            data={a}
          />
        )}
      </div>
    </div>
  );
}

function AnalyticsTab({ tab, isLoading, error, data }: {
  tab: Exclude<StockTab, 'stock'>;
  isLoading: boolean;
  error: Error | null;
  data: ReturnType<typeof useProductAnalytics>['data'];
}): JSX.Element {
  if (isLoading) {
    return <div className="py-16 text-center text-sm text-text-secondary">Loading analytics…</div>;
  }
  if (error !== null && error !== undefined) {
    return (
      <div role="alert" className="rounded-lg border border-red bg-red-soft p-3 text-sm text-red">
        Failed to load analytics: {error.message}
      </div>
    );
  }
  if (data === null || data === undefined) {
    return <div className="py-16 text-center text-sm text-text-secondary">No analytics data.</div>;
  }
  switch (tab) {
    case 'movements':  return <MovementsSection data={data} />;
    case 'purchase':   return <PurchaseSection data={data} />;
    case 'transfers':  return <TransfersSection data={data} />;
    case 'production': return <ProductionLossSection data={data} />;
  }
}
