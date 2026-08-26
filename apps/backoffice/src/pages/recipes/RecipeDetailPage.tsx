// apps/backoffice/src/pages/recipes/RecipeDetailPage.tsx
//
// Session 31 / Wave 2.C — Read-only recipe detail page (no actions).
// Keyed on :productId (the output product). Route-level gate `reports.inventory.read`.

import type { JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Scale } from 'lucide-react';
import { Card, Button, Badge, EmptyState } from '@breakery/ui';
import { formatCurrency, formatQuantity } from '@breakery/utils';
import { useRecipeDetail } from '@/features/recipes/hooks/useRecipeDetail.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { formatPct1, sharePct } from '@/features/reports/utils/reportFigures.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { DetailPageSkeleton } from '@/components/DetailPageSkeleton.js';
import { PAGE_TITLE_CLS } from '@/components/PageHeader.js';

/** Cellule numérique : mono tabulaire alignée à droite (The Mono-Carries-Data Rule). */
const NUM_CELL = 'px-3 py-2 text-right font-data tabular-nums';

function fmtIdr(amount: number | null): string {
  return formatCurrency(Number(amount ?? 0));
}

/** Part d'une ligne dans le coût. Sans base positive, un tiret — jamais 0 % ni NaN. */
function fmtShare(part: number, base: number): string {
  return base > 0 ? formatPct1(sharePct(part, base)) : '—';
}

export function RecipeDetailPage(): JSX.Element {
  const { productId } = useParams<{ productId: string }>();
  const { data, isLoading, error, refetch } = useRecipeDetail(productId);

  if (isLoading) {
    return <DetailPageSkeleton label="Loading recipe" data-testid="recipe-detail-loading" />;
  }
  if (error !== null && error !== undefined) {
    return (
      <QueryErrorBanner
        detail={errorDetailText(error)}
        onRetry={() => { void refetch(); }}
        data-testid="recipe-detail-error"
      >
        This recipe could not be loaded — nothing below is shown, so no cost
        here is a zero.
      </QueryErrorBanner>
    );
  }
  if (data === null || data === undefined) {
    return (
      <div className="space-y-4">
        <Link
          to="/backoffice/inventory/recipes"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to recipes
        </Link>
        <EmptyState
          icon={Scale}
          title="Recipe not found"
          description="This product has no recipe, or it may have been deleted."
          size="md"
        />
      </div>
    );
  }

  const { product, active_version_number, version_count, bom, total_cost } = data;
  // Le pied somme les lignes DE LA TABLE ; l'en-tête de carte porte le total du payload.
  const lineCostTotal = bom.reduce((sum, r) => sum + Number(r.line_cost ?? 0), 0);
  const costBase = Number(total_cost ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" asChild>
          <Link to="/backoffice/inventory/recipes">
            <ArrowLeft size={16} /> Back
          </Link>
        </Button>
        <h1 className={PAGE_TITLE_CLS}>{product.name}</h1>
        {product.is_semi_finished && (
          <Badge variant="info">Semi-finished</Badge>
        )}
        {active_version_number != null && (
          <span className="text-sm text-text-muted">
            v{active_version_number} ({version_count} versions)
          </span>
        )}
      </div>

      <Card className="p-4 space-y-1">
        <h2 className="text-sm font-medium text-text-muted">Output product</h2>
        <div className="text-sm">
          SKU: {product.sku ?? '—'} · Unit: {product.unit ?? '—'}
        </div>
        <div className="text-sm">
          Cost / unit (current): <strong>{fmtIdr(product.cost_price)}</strong>
        </div>
        <div className="text-sm">
          <DrilldownLink entity="product" id={product.id} label="View product detail" />
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-muted">
            Ingredients (cascade flat, depth ≤ 5)
          </h2>
          <div className="text-sm">
            Computed cost: <strong>{fmtIdr(total_cost)}</strong>
          </div>
        </div>
        {bom.length === 0 ? (
          <div className="text-sm text-text-muted">No ingredients recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Ingredients, unit cost, stock on hand and share of the recipe cost
              </caption>
              <thead className="border-b border-border-subtle bg-surface-inert font-data text-xs font-semibold uppercase tracking-widest text-text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Material</th>
                  <th scope="col" className="px-3 py-2 text-right">Qty / unit</th>
                  <th scope="col" className="px-3 py-2 text-left">Unit</th>
                  <th scope="col" className="px-3 py-2 text-right">Cost / material unit</th>
                  <th scope="col" className="px-3 py-2 text-right">Stock on hand</th>
                  <th scope="col" className="px-3 py-2 text-right">Line cost</th>
                  <th scope="col" className="px-3 py-2 text-right">% of cost</th>
                </tr>
              </thead>
              <tbody>
                {bom.map((r) => (
                  <tr key={r.material_id} className="border-t border-border-subtle">
                    <td className="px-3 py-2">
                      <DrilldownLink
                        entity="product"
                        id={r.material_id}
                        label={r.material_name}
                        icon={false}
                      />
                    </td>
                    {/* La quantité s'affiche DANS l'unité de la colonne voisine :
                        `qty_in_base` est la quantité de recette convertie dans
                        l'unité de stock de la matière (serveur, recipe_bom_full_v2).
                        `qty_per_unit` est en unité de RECETTE — rendu à côté de
                        `material_unit`, il annonçait 115 kg pour 115 gr. */}
                    <td className={NUM_CELL}>{formatQuantity(r.qty_in_base, null)}</td>
                    <td className="px-3 py-2">{r.material_unit}</td>
                    <td className={NUM_CELL}>{fmtIdr(r.cost_price)}</td>
                    <td className={NUM_CELL}>{r.current_stock}</td>
                    <td className={NUM_CELL}>{fmtIdr(r.line_cost)}</td>
                    <td className={NUM_CELL}>{fmtShare(Number(r.line_cost ?? 0), costBase)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border-subtle bg-surface-inert font-semibold">
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-right">Total</td>
                  <td className={NUM_CELL}>{fmtIdr(lineCostTotal)}</td>
                  <td className={NUM_CELL}>{fmtShare(lineCostTotal, costBase)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
