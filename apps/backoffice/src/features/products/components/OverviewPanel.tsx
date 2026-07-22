// apps/backoffice/src/features/products/components/OverviewPanel.tsx
//
// Session 14 / Phase 4.B — Overview tab on product detail page.
// Mirrors `Product detail1.jpg` and `Product detail2.jpg`:
//   - Photo card (left), Stock + Revenue + Gross margin + Conversion (right)
//   - Performance(30D) + Price & Margin
//   - Last stock movements + Price history (placeholders for v1)

import { Activity, AlertCircle, BarChart3, ImageOff, Settings2, TrendingUp } from 'lucide-react';
import type { JSX } from 'react';
import { Card, CardContent, Currency, SectionLabel } from '@breakery/ui';
import type { ProductRow } from '../types.js';

interface Props {
  product: ProductRow;
}

export function OverviewPanel({ product }: Props): JSX.Element {
  // Produit non suivi (track_inventory=false, hors vitrine) = illimité : pas de
  // stock propre à afficher. Une quantité (souvent 0) induirait "Out of stock".
  const untracked = !product.track_inventory && !product.is_display_item;
  const stockOk = product.current_stock > 0;
  const margin = product.retail_price > 0 && product.cost_price > 0
    ? Math.round(((product.retail_price - product.cost_price) / product.retail_price) * 100)
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card padding="none" className="md:row-span-2">
          <CardContent className="flex aspect-square w-full items-center justify-center bg-bg-overlay text-text-muted">
            {product.image_url === null ? (
              <div className="flex flex-col items-center gap-2">
                <ImageOff className="h-10 w-10" aria-hidden />
                <span className="text-xs uppercase tracking-widest">No photo</span>
              </div>
            ) : (
              <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
            )}
          </CardContent>
        </Card>

        <MetricCard
          icon={<AlertCircle className="h-4 w-4" aria-hidden />}
          label="Stock"
          tone={untracked ? 'default' : stockOk ? 'gold' : 'danger'}
        >
          {untracked ? (
            <>
              <div className="font-data text-3xl tabular-nums text-text-primary">∞</div>
              <div className="text-xs text-text-secondary">Non suivi (illimité)</div>
            </>
          ) : (
            <>
              <div className="font-data text-3xl tabular-nums text-text-primary">
                {product.current_stock}
              </div>
              <div className="text-xs text-text-secondary">{product.unit} available</div>
              {!stockOk && (
                <div className="mt-3 text-xs font-semibold uppercase tracking-widest text-red">
                  Out of stock
                </div>
              )}
            </>
          )}
        </MetricCard>

        <MetricCard
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          label="Revenue (30d)"
        >
          <div className="font-mono text-2xl tabular-nums text-text-primary">IDR 0</div>
          <div className="text-xs text-text-secondary">0 units sold</div>
        </MetricCard>

        <MetricCard
          icon={<BarChart3 className="h-4 w-4" aria-hidden />}
          label="Gross margin"
        >
          {margin === null ? (
            <div className="text-2xl text-text-muted">—</div>
          ) : (
            <div className="font-mono text-2xl tabular-nums text-text-primary">{margin}%</div>
          )}
          {product.cost_price > 0 && (
            <div className="text-xs text-text-secondary">
              Cost: <Currency amount={product.cost_price} />
            </div>
          )}
        </MetricCard>

        <MetricCard
          icon={<Settings2 className="h-4 w-4" aria-hidden />}
          label="Conversion"
        >
          <div className="font-mono text-2xl tabular-nums text-text-muted">0%</div>
          <div className="text-xs text-text-secondary">In 0 / 0 orders</div>
        </MetricCard>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card padding="md">
          <div className="mb-4 flex items-center gap-2 text-gold">
            <Activity className="h-4 w-4" aria-hidden />
            <SectionLabel as="h2" size="sm">Performance (30d)</SectionLabel>
          </div>
          <div className="space-y-3 text-sm">
            <Row label="Units sold" value="0" />
            <Row label="Conversion rate" value="0%" />
            <Row label="Orders with product" value="0 / 0" />
            <Row label="Total revenue" value="IDR 0" mono />
          </div>
        </Card>

        <Card padding="md">
          <div className="mb-4 flex items-center gap-2 text-gold">
            <SectionLabel as="h2" size="sm">Price & margin</SectionLabel>
          </div>
          <div className="space-y-3 text-sm">
            <Row label="Retail price" value={product.retail_price > 0 ? <Currency amount={product.retail_price} emphasis="gold" /> : '—'} />
            <Row label="Wholesale price" value={product.wholesale_price === null || product.wholesale_price === 0 ? '—' : <Currency amount={product.wholesale_price} />} />
            <Row label="Cost price" value={product.cost_price > 0 ? <Currency amount={product.cost_price} /> : '—'} />
          </div>
        </Card>
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon:  JSX.Element;
  label: string;
  tone?: 'default' | 'gold' | 'danger';
  children: React.ReactNode;
}

function MetricCard({ icon, label, tone = 'default', children }: MetricCardProps): JSX.Element {
  const accent =
    tone === 'gold'   ? 'border-gold-soft text-gold'
  : tone === 'danger' ? 'border-red text-red'
  :                     'border-border-subtle text-text-secondary';
  return (
    <Card padding="md" className={accent}>
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel as="div" size="xs">{label}</SectionLabel>
        <span aria-hidden>{icon}</span>
      </div>
      {children}
    </Card>
  );
}

interface RowProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function Row({ label, value, mono = false }: RowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-subtle pb-3 last:border-0 last:pb-0">
      <span className="text-text-secondary">{label}</span>
      <span className={mono ? 'font-mono tabular-nums text-text-primary' : 'text-text-primary'}>
        {value}
      </span>
    </div>
  );
}
