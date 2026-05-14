// apps/backoffice/src/pages/Products.tsx
import { Check, Star } from 'lucide-react';
import { Currency } from '@breakery/ui';
import { useProducts } from '@/features/products/hooks/useProducts.js';

export default function ProductsPage() {
  const { data: products = [], isLoading, error } = useProducts();

  if (isLoading) return <div className="text-text-secondary">Loading…</div>;
  if (error) return <div className="text-red">Failed to load products: {error.message}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Products</h1>
        <p className="text-text-secondary text-sm mt-1">Read-only view (CRUD arrives in a future session).</p>
      </div>

      <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="text-left px-4 py-3 w-32">SKU</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-right px-4 py-3 w-32">Price</th>
              <th className="text-right px-4 py-3 w-32">Stock</th>
              <th className="text-right px-4 py-3 w-24">Active</th>
              <th className="text-right px-4 py-3 w-24">Favorite</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-border-subtle hover:bg-bg-overlay">
                <td className="px-4 py-3 font-mono text-text-secondary">{p.sku}</td>
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3 text-right"><Currency amount={p.retail_price} emphasis="gold" /></td>
                <td className="px-4 py-3 text-right font-mono">{p.current_stock}</td>
                <td className="px-4 py-3 text-right">
                  {p.is_active ? (
                    <Check className="inline h-4 w-4 text-text-primary" aria-label="active" />
                  ) : (
                    <span aria-hidden>—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {p.is_favorite ? (
                    <Star className="inline h-4 w-4 fill-gold text-gold" aria-label="favorite" />
                  ) : (
                    <span aria-hidden>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
