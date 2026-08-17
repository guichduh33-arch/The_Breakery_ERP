import { IngredientPicker, type IngredientSearchResult } from '@breakery/ui';

// Autocomplete matières du back-office (RecipeEditor / ProductionForm) — thème ivoire.
const fixtures: IngredientSearchResult[] = [
  { product_id: 'rm-021', sku: 'RM-021', name: 'Farine T55', unit: 'kg', cost_price: 12_000, current_stock: 48, kind: 'raw', has_recipe: false },
  { product_id: 'rm-034', sku: 'RM-034', name: 'Beurre AOP Charentes', unit: 'kg', cost_price: 145_000, current_stock: 12, kind: 'raw', has_recipe: false },
  { product_id: 'sf-008', sku: 'SF-008', name: 'Pâte feuilletée', unit: 'kg', cost_price: 38_500, current_stock: 6, kind: 'semi_finished', has_recipe: true },
  { product_id: 'sf-011', sku: 'SF-011', name: 'Crème pâtissière', unit: 'kg', cost_price: 52_000, current_stock: 4, kind: 'semi_finished', has_recipe: true },
];

// Fonction de recherche statique — résultat initial identique quelle que soit la requête.
const searchFn = async () => fixtures;

// Recherche ouverte : input focus programmatique → panneau de résultats déplié,
// badges de kind (Raw / Semi-finished) et compteurs sur les onglets.
export const Recherche = () => (
  <div className="theme-backoffice min-h-[440px] bg-bg-base p-6">
    <div
      className="w-[560px]"
      ref={(el) => {
        el?.querySelector('input')?.focus();
      }}
    >
      <IngredientPicker value={null} onChange={() => {}} searchFn={searchFn} />
    </div>
  </div>
);

// État replié avec onglets de filtre (compteurs alimentés par la recherche initiale).
export const Filtres = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <div className="w-[560px]">
      <IngredientPicker
        value="rm-021"
        onChange={() => {}}
        searchFn={searchFn}
        placeholder="Rechercher une matière ou un semi-fini…"
      />
    </div>
  </div>
);
