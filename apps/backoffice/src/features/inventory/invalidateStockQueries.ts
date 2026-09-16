import type { QueryClient } from '@tanstack/react-query';

/** Une écriture de stock rend périmées toutes ses projections, pas seulement la liste. */
export async function invalidateStockQueries(client: QueryClient): Promise<void> {
  await Promise.all([
    'stock-levels', 'stock-movements', 'stock-ledger', 'stock-movements-feed',
    'movement-aggregates', 'products-typeahead', 'products', 'product-dashboard',
    'product-analytics', 'low-stock-v2', 'reorder-suggestions-v1',
    'production-suggestions', 'stock-config-issues-v2',
  ].map((key) => client.invalidateQueries({ queryKey: [key] })));
}
