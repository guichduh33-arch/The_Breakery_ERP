// apps/backoffice/src/pages/recipes/RecipeDetailPage.tsx
//
// Session 31 / Wave 2.C — Read-only recipe detail page (no actions).
// Keyed on :productId (the output product). Route-level gate `reports.inventory.read`.

import type { JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, Button, Badge } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useRecipeDetail } from '@/features/recipes/hooks/useRecipeDetail.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

function fmtIdr(amount: number | null): string {
  return `Rp ${formatIdr(Number(amount ?? 0))}`;
}

export function RecipeDetailPage(): JSX.Element {
  const { productId } = useParams<{ productId: string }>();
  const { data, isLoading } = useRecipeDetail(productId);

  if (isLoading || !data) {
    return <div className="p-8">Loading…</div>;
  }

  const { product, active_version_number, version_count, bom, total_cost } = data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" asChild>
          <Link to="/backoffice/inventory/recipes">
            <ArrowLeft size={16} /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold font-fraunces">{product.name}</h1>
        {product.is_semi_finished && (
          <Badge variant="info">Semi-finished</Badge>
        )}
        {active_version_number != null && (
          <span className="text-sm text-muted-foreground">
            v{active_version_number} ({version_count} versions)
          </span>
        )}
      </div>

      <Card className="p-4 space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground">Output product</h2>
        <div className="text-sm">
          SKU : {product.sku ?? '—'} · Unit : {product.unit ?? '—'}
        </div>
        <div className="text-sm">
          Cost / unit (current) : <strong>{fmtIdr(product.cost_price)}</strong>
        </div>
        <div className="text-sm">
          <DrilldownLink entity="product" id={product.id} label="View product detail" />
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Ingredients (cascade flat, depth ≤ 5)
          </h2>
          <div className="text-sm">
            Computed cost : <strong>{fmtIdr(total_cost)}</strong>
          </div>
        </div>
        {bom.length === 0 ? (
          <div className="text-sm text-muted-foreground">No ingredients recorded.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2">Material</th>
                <th className="pb-2 text-right">Qty / unit</th>
                <th className="pb-2">Unit</th>
                <th className="pb-2 text-right">Cost / material unit</th>
                <th className="pb-2 text-right">Stock on hand</th>
                <th className="pb-2 text-right">Line cost</th>
              </tr>
            </thead>
            <tbody>
              {bom.map((r) => (
                <tr key={r.material_id} className="border-t">
                  <td className="py-2">
                    <DrilldownLink
                      entity="product"
                      id={r.material_id}
                      label={r.material_name}
                      icon={false}
                    />
                  </td>
                  <td className="text-right">{r.qty_per_unit}</td>
                  <td>{r.material_unit}</td>
                  <td className="text-right">{fmtIdr(r.cost_price)}</td>
                  <td className="text-right">{r.current_stock}</td>
                  <td className="text-right">{fmtIdr(r.qty_per_unit * r.cost_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
