import type { QueryClient } from '@tanstack/react-query';

/** Une sous-recette peut changer le coût de plusieurs produits parents. */
export async function invalidateRecipeCosts(qc: QueryClient): Promise<void> {
  await Promise.all([
    ['products'],
    ['inventory-production', 'recipes'],
    ['inventory-production', 'product-summary'],
    ['inventory-production', 'recipe-versions'],
    ['recipe-direct-cost'],
    ['recipe-bom-full'],
    ['margin-alerts'],
  ].map((queryKey) => qc.invalidateQueries({ queryKey })));
}
