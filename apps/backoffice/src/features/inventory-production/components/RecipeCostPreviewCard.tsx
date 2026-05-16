// apps/backoffice/src/features/inventory-production/components/RecipeCostPreviewCard.tsx
//
// Session 15 / Phase 3.B — Recipe preview card.
//
// Top-of-editor summary showing:
// - product photo / placeholder
// - sku + name + selling (retail) price
// - material cost per produced unit (Σ qty × material_cost_price for 1 unit)
// - theoretical margin % with color coding (green ≥60, amber 40-60, red <40)
// - "Recompute" validation badge when |Σ(qty × cost) - product.cost_price| /
//   product.cost_price > 5% (Spec §6.3.B last bullet)

import { useMemo, type JSX } from 'react';
import { Badge, Card, cn } from '@breakery/ui';
import { bomCost, type RecipeRow } from '@breakery/domain';
import { useProductSummary } from '../hooks/useProductSummary.js';

export interface RecipeCostPreviewCardProps {
  productId: string | null;
  rows:      RecipeRow[];
}

const RECOMPUTE_THRESHOLD = 0.05; // 5%

function formatCurrency(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

type MarginTone = 'green' | 'amber' | 'red' | 'muted';

function marginTone(marginPct: number | null): MarginTone {
  if (marginPct === null || !Number.isFinite(marginPct)) return 'muted';
  if (marginPct >= 60) return 'green';
  if (marginPct >= 40) return 'amber';
  return 'red';
}

const MARGIN_TONE_CLASS: Record<MarginTone, string> = {
  green: 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/40',
  amber: 'bg-amber-500/15 text-amber-700 border border-amber-500/40',
  red:   'bg-red-500/15 text-red-700 border border-red-500/40',
  muted: 'bg-bg-overlay text-text-secondary border border-border-subtle',
};

export function RecipeCostPreviewCard({
  productId,
  rows,
}: RecipeCostPreviewCardProps): JSX.Element {
  const product = useProductSummary(productId);

  // Material cost / 1 produced unit (BoM-resolved).
  const unitMaterialCost = useMemo<number | null>(() => {
    if (rows.length === 0) return null;
    try {
      return bomCost(rows, 1).unit_cost;
    } catch {
      return null;
    }
  }, [rows]);

  const retail = product.data?.retail_price ?? null;
  const storedCost = product.data?.cost_price ?? null;

  const marginPct = useMemo<number | null>(() => {
    if (unitMaterialCost === null || retail === null || retail <= 0) return null;
    return ((retail - unitMaterialCost) / retail) * 100;
  }, [unitMaterialCost, retail]);

  const recomputeNeeded = useMemo<boolean>(() => {
    if (unitMaterialCost === null || storedCost === null || storedCost <= 0) {
      return false;
    }
    const drift = Math.abs(unitMaterialCost - storedCost) / storedCost;
    return drift > RECOMPUTE_THRESHOLD;
  }, [unitMaterialCost, storedCost]);

  if (productId === null) {
    return (
      <Card variant="inset" padding="md" className="text-text-secondary text-sm">
        Select a finished product to see the cost preview.
      </Card>
    );
  }

  if (product.isLoading) {
    return (
      <Card variant="inset" padding="md" className="text-text-secondary text-sm">
        Loading product…
      </Card>
    );
  }

  if (product.data === null || product.data === undefined) {
    return (
      <Card variant="inset" padding="md" className="text-text-secondary text-sm">
        Product not found.
      </Card>
    );
  }

  const p = product.data;
  const tone = marginTone(marginPct);

  return (
    <Card variant="elevated" padding="md" data-testid="recipe-cost-preview-card">
      <div className="flex items-start gap-4">
        {/* Photo / placeholder */}
        <div
          className={cn(
            'h-20 w-20 shrink-0 rounded-md overflow-hidden border border-border-subtle',
            'bg-bg-elevated flex items-center justify-center text-text-muted text-xs',
          )}
          data-testid="product-photo"
        >
          {p.image_url !== null && p.image_url !== '' ? (
            <img
              src={p.image_url}
              alt={p.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <span aria-hidden>No image</span>
          )}
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-serif text-lg font-semibold text-text-primary truncate">
                {p.name}
              </h3>
              <p className="text-xs uppercase tracking-widest text-text-secondary">
                {p.sku} · per {p.unit}
              </p>
            </div>
            {recomputeNeeded && (
              <Badge
                variant="default"
                className="bg-amber-500/15 text-amber-700 border border-amber-500/40"
                title={`Stored cost_price (${formatCurrency(storedCost)}) drifts > 5% from current BoM (${formatCurrency(unitMaterialCost)}). Consider refreshing the product cost.`}
                data-testid="recompute-badge"
              >
                Recompute
              </Badge>
            )}
          </div>

          {/* Numbers row */}
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-widest text-text-secondary">
                Selling price
              </div>
              <div className="font-mono font-semibold text-text-primary" data-testid="selling-price">
                {formatCurrency(retail)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-text-secondary">
                Material cost / unit
              </div>
              <div className="font-mono font-semibold text-text-primary" data-testid="material-cost">
                {formatCurrency(unitMaterialCost)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-text-secondary">
                Margin
              </div>
              <div className="flex items-center" data-testid="margin-pct" data-tone={tone}>
                {marginPct === null ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  <Badge
                    variant="default"
                    className={cn('font-mono', MARGIN_TONE_CLASS[tone])}
                  >
                    {marginPct.toFixed(1)}%
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default RecipeCostPreviewCard;
