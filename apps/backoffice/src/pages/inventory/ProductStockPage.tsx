// apps/backoffice/src/pages/inventory/ProductStockPage.tsx
//
// Consolidated stock-management view for ONE product, reached by clicking an
// item in Stock & Inventory. Dissociated from the product configuration sheet
// (/backoffice/products/:productId), which now holds only general settings.
//
// Tabbed to keep each view light (2026-06-23):
//   - Stock       live KPIs · velocity
//   - Movements   stock timeline · movement breakdown · recent movements
//   - Purchase    purchase price trend · purchase pattern · incoming POs
//   - Production   weekly consumption · recipe usage · production · waste · opname
//
// ADR-027 — l'onglet Transferts et la ventilation de stock par section ont
// disparu : `products.current_stock` est l'unique niveau de stock.
//
// URL: /backoffice/inventory/:productId

import { useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Package, Settings2 } from 'lucide-react';
import { EmptyState, cn } from '@breakery/ui';
import { KpiTile, KPI_NOTE } from '@/components/kpi/KpiTile.js';
import { formatIdr, formatIdrShort } from '@/features/dashboard/utils/format.js';
import { formatQuantity } from '@breakery/utils';
import { useProductDetail } from '@/features/products/hooks/useProductDetail.js';
import { useProductAnalytics } from '@/features/products/hooks/useProductAnalytics.js';
import {
  MovementsSection, PurchaseSection, ProductionLossSection,
} from '@/features/products/components/StockAnalyticsPanel.js';
import { useProductDashboard } from '@/features/inventory-dashboard/hooks/useProductDashboard.js';
import { SalesVelocityChart } from '@/features/inventory-dashboard/components/SalesVelocityChart.js';
import { PageHeader } from '@/components/PageHeader.js';

const WINDOW_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 7,  label: '7 days'  },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
];

type StockTab = 'stock' | 'movements' | 'purchase' | 'production';
const TABS: readonly { id: StockTab; label: string }[] = [
  { id: 'stock',      label: 'Stock'      },
  { id: 'movements',  label: 'Movements'  },
  { id: 'purchase',   label: 'Purchase'   },
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
    return (
      <div className="space-y-4">
        <Link to="/backoffice/inventory" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to inventory
        </Link>
        <EmptyState
          icon={Package}
          title="Product not found"
          description="This product may have been deleted or you do not have access."
          size="md"
        />
      </div>
    );
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
        <PageHeader
          className="mt-2"
          title={p.name}
          subtitle={<span className="font-mono text-xs text-text-muted">{p.sku}</span>}
          actions={
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
          }
        />
      </header>

      {/* Live stock KPIs — always visible above the tabs */}
      {/* Rangée ENTIÈRE basculée sur la tuile du back-office — le lot D+F avait
          converti les autres bandes et manqué celle-ci. La tuile de
          `@breakery/ui` porte une icône et un corps qui ne sont pas ceux de la
          direction « Instrument » (DESIGN.md § Tuile de KPI : « Sans icône —
          six pastilles d'icône côte à côte donnaient une frise décorative où
          l'œil ne trouvait plus le chiffre »).

          « Value at cost » débordait : `formatCurrency` rendait `Rp 12.500.000`
          soit 248 px de contenu mesuré dans une tuile qui en offre 34 de haut et
          bien moins de large — The Value-Width Rule. La notation compacte
          (`formatIdrShort`) tient sur une ligne, et `valueTitle` porte le
          montant EXACT en infobulle : un compact tronque, sans lui le chiffre
          précis ne serait lisible nulle part sur la page. */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Stock KPIs">
        <KpiTile
          label="Current stock"
          value={p.track_inventory || p.is_display_item ? formatQuantity(p.current_stock, p.unit) : 'Not tracked'}
        />
        <KpiTile
          label="Value at cost"
          value={formatIdrShort(valueAtCost)}
          valueTitle={formatIdr(valueAtCost)}
        />
        {/* Les deux tuiles de vente passent une CHAÎNE déjà formatée par
            `formatQuantity` : sans elle le séparateur de milliers dépendrait du
            navigateur, soit deux notations sur une même rangée. */}
        <KpiTile
          label="Units sold"
          value={d ? formatQuantity(d.summary.units_sold, null) : '—'}
        >
          <span className={KPI_NOTE}>{days}-day window</span>
        </KpiTile>
        <KpiTile
          label="Avg per day"
          value={d ? formatQuantity(d.summary.avg_daily_units, null) : '—'}
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
    case 'production': return <ProductionLossSection data={data} />;
  }
}
