// apps/backoffice/src/features/products/types.ts
//
// Session 14 / Phase 4.B — Local types for the Products feature.
//
// We extend the canonical `Product` from @breakery/domain with denormalised
// data the catalog list needs (category name + cost_price) without polluting
// the IO-free domain types. The shape mirrors the columns selected by
// `useProducts` / `useProductDetail`.

import type { Product } from '@breakery/domain';

export type ProductTypeFilter = 'all' | 'finished' | 'semi-finished' | 'raw' | 'combo';

/** Session 27c — Variant-grouping filter for the catalog list. */
export type ProductVariantFilter = 'all' | 'standalone' | 'parents' | 'variants';

export interface ProductRow extends Product {
  cost_price: number;
  unit: string;
  min_stock_threshold: number;
  category_name: string | null;
  /**
   * Authoritative conceptual type, from `categories.category_type`
   * ('raw_material' | 'semi_finished' | 'finished'). Drives `classifyProduct`;
   * the old SKU-prefix heuristic was unreliable (only RAW/CON/HAS/SFG matched).
   */
  category_type: string | null;
  // Session 27 — editable fields surfaced by update_product_v2
  description: string | null;
  visible_on_pos: boolean;
  available_for_sale: boolean;
  track_inventory: boolean;
  deduct_stock: boolean;
  is_semi_finished: boolean;
  target_gross_margin_pct: number | null;
  default_shelf_life_hours: number | null;
  // POS display-stock isolation (Wave 6) — when true, the product is sold off
  // a separate "vitrine" counter (display_stock), not the BO global inventory.
  is_display_item: boolean;
  // ADR-007 déc. 6 — test-data flag (excluded from reports). NOT in the
  // update_product allowlist : written only via set_product_is_test_v1
  // (gate products.test_flag.update, ADMIN+). Optional : seul le hook
  // détail (useProductDetail) le sélectionne, pas les hooks de liste.
  is_test?: boolean;
  // Session 27c — variant grouping (parent / variant / standalone).
  // `parent_product_id` is null on parents and standalones, set on variants.
  // `variant_label`, `variant_axis`, `variant_sort_order` are null on
  // standalones, populated on variants.
  parent_product_id: string | null;
  variant_label: string | null;
  variant_axis: string | null;
  variant_sort_order: number;
  // Spec B-1 Ph2 — per-product dispatch override. NULL = inherit from category.
  // Non-null = explicit list ⊆ {kitchen,barista,display} (CHECK on DB side).
  dispatch_stations: readonly string[] | null;
}

export interface CategoryOption {
  id:    string;
  name:  string;
  slug:  string;
  is_active: boolean;
  sort_order: number;
}

export type ProductView = 'grid' | 'list';

export interface ProductsFilterState {
  search:     string;
  categoryId: string; // 'all' = pas de filtre catégorie
  type:       ProductTypeFilter;
  view:       ProductView;
}

export interface ProductsKpis {
  total:          number;
  finished:       number;
  semi_finished:  number;
  raw_material:   number;
  combo:          number;
  /** Écran 2a — compteurs de QUALITÉ DE DONNÉE, pas de volumétrie. */
  inactive:       number;
  no_cost_price:  number;
}

/**
 * Écran 2a — la bande de compteurs est un FILTRE, pas un affichage.
 *
 * Quatre tuiles décoratives sont devenues sept compteurs qui répondent chacun à
 * « quelles lignes dois-je regarder ». Les cinq premiers découpent le catalogue
 * par nature ; les deux derniers isolent un défaut à corriger — un produit
 * désactivé qui traîne, un produit sans prix de revient (donc sans marge, donc
 * invisible dans toute analyse de coût). C'est ce qui rend la bande productive
 * au lieu d'ornementale.
 */
export type ProductCounter =
  | 'all' | 'finished' | 'semi-finished' | 'raw' | 'combo'
  | 'inactive' | 'no-cost';

/**
 * Colonnes MASQUABLES de la table catalogue. Product, SKU et les actions n'en
 * font pas partie : sans elles la ligne n'est plus identifiable ni actionnable,
 * et une table dont on peut masquer l'identifiant est une table cassée.
 */
export type ProductColumnId =
  | 'type' | 'category' | 'stock' | 'cost' | 'retail' | 'wholesale' | 'margin' | 'status';

/**
 * Colonnes masquées À L'OUVERTURE de la table catalogue.
 *
 * Onze colonnes ne tiennent pas dans les 1219 px utiles d'un écran 1280 : le
 * budget calibré (voir l'en-tête de `ProductsTable`) demande 1212 px à DIX
 * colonnes, une fois les trois colonnes monétaires portées à la largeur qu'un
 * montant à neuf chiffres exige. Il fallait donc en retirer une.
 *
 * C'est `type` — la seule dont le contenu est REDONDANT avec le reste de la
 * ligne : un produit fini, une matière première ou un semi-fini se lisent déjà
 * dans sa catégorie, son SKU et la présence ou non d'un prix de vente. Rien
 * n'est perdu : le menu Columns la rappelle en un clic, et l'utilisateur qui
 * l'affiche accepte le défilement horizontal en connaissance de cause.
 */
export const PRODUCT_DEFAULT_HIDDEN_COLUMNS: readonly ProductColumnId[] = ['type'];

export const PRODUCT_COLUMNS: readonly { id: ProductColumnId; label: string }[] = [
  { id: 'type',      label: 'Type' },
  { id: 'category',  label: 'Category' },
  { id: 'stock',     label: 'Stock' },
  { id: 'cost',      label: 'Cost' },
  { id: 'retail',    label: 'Retail' },
  { id: 'wholesale', label: 'Wholesale' },
  { id: 'margin',    label: 'Margin' },
  { id: 'status',    label: 'Status' },
];

/**
 * Le choix de colonnes, lu et écrit dans l'URL (`?hide=`).
 *
 * C'était le SEUL état de liste du catalogue resté hors URL : on réglait ses
 * colonnes, on ouvrait une fiche, on revenait — les filtres, la page et le tri
 * étaient restaurés, les colonnes non. Une restauration partielle est la pire
 * des trois options : elle rend la page presque comme on l'a laissée, donc on
 * ne remarque pas ce qui manque.
 *
 * Trois états, et le troisième est la raison du sentinel :
 *
 *   · paramètre ABSENT      → le défaut (`PRODUCT_DEFAULT_HIDDEN_COLUMNS`) ;
 *   · `hide=none`           → RIEN de masqué, choix explicite de l'utilisateur ;
 *   · `hide=type,margin`    → cette liste, bornée aux colonnes connues.
 *
 * Sans `none`, « je n'ai rien choisi » et « j'ai tout affiché » s'écriraient
 * tous deux paramètre vide — et le défaut (qui masque `type`, faute de budget
 * de largeur) écraserait au rechargement le choix de celui qui vient
 * précisément de la rappeler.
 */
export const PRODUCT_HIDE_NONE = 'none';

/** Borne une valeur d'URL sur les colonnes connues — `?hide=lol` ne casse rien. */
export function parseHiddenColumns(raw: string | null): ReadonlySet<ProductColumnId> {
  if (raw === null || raw === '') return new Set(PRODUCT_DEFAULT_HIDDEN_COLUMNS);
  if (raw === PRODUCT_HIDE_NONE) return new Set();
  const known = new Set<string>(PRODUCT_COLUMNS.map((c) => c.id));
  const kept = raw.split(',').filter((id): id is ProductColumnId => known.has(id));
  // Aucun jeton reconnu = valeur bricolée : on retombe sur le défaut plutôt que
  // sur « tout afficher », qui est un choix que personne n'a fait.
  return kept.length === 0 ? new Set(PRODUCT_DEFAULT_HIDDEN_COLUMNS) : new Set(kept);
}

/** Valeur d'URL pour un jeu de colonnes masquées — `null` quand c'est le défaut. */
export function serializeHiddenColumns(hidden: ReadonlySet<ProductColumnId>): string | null {
  // Ordre CANONIQUE (celui de PRODUCT_COLUMNS) et non celui du Set : sans lui,
  // deux clics inverses produiraient deux URL différentes pour le même écran.
  const ids = PRODUCT_COLUMNS.map((c) => c.id).filter((id) => hidden.has(id));
  const def = [...PRODUCT_DEFAULT_HIDDEN_COLUMNS];
  if (ids.length === def.length && ids.every((id, i) => id === def[i])) return null;
  return ids.length === 0 ? PRODUCT_HIDE_NONE : ids.join(',');
}

/**
 * Marge unitaire d'un produit, en pourcentage du prix de vente.
 *
 * Rend `null` — jamais 0 — dès qu'un des deux côtés manque : une marge de 0 %
 * et une marge INCONNUE sont deux choses différentes, et les confondre ferait
 * passer pour « vendu à prix coûtant » un produit dont on ignore simplement le
 * coût. C'est exactement la population que compte le compteur « No cost price ».
 */
export function productMarginPct(
  p: Pick<ProductRow, 'retail_price' | 'cost_price'>,
): number | null {
  if (p.retail_price <= 0 || p.cost_price <= 0) return null;
  return ((p.retail_price - p.cost_price) / p.retail_price) * 100;
}

/**
 * Single product page tabs — must mirror the screenshot family
 * (`Product detail1.jpg`, `product general 1/2/3.jpg`, `product unit.jpg`,
 * `product recette.jpg`, ...).
 */
export type ProductDetailTab =
  // 'overview' retiré (distill) : l'onglet ne portait aucun bloc propre.
  // 'analytics' reste déclaré sans panneau — arbitrage non tranché.
  | 'analytics'
  | 'general'
  | 'units'
  | 'recipe'
  | 'variants'
  | 'modifiers'
  | 'costing'
  | 'purchase'
  | 'stations'
  | 'history';

/**
 * The four conceptual product types surfaced in the tabs filter, KPI grid and
 * the catalog "Type" column.
 *
 * The authoritative source is the product's `categories.category_type`
 * ('raw_material' | 'semi_finished' | 'finished') — NOT the `product_type`
 * column (schema only allows 'finished' | 'combo') nor the SKU prefix. The old
 * SKU-prefix heuristic only recognised RAW/CON/HAS/SFG, so raw materials with
 * any other prefix (SEE, PAC, VEG, DAI, DRY, FRU…) were mislabelled 'Finished'.
 *
 * `combo` still comes from `product_type`. When `category_type` is absent we
 * fall back to the per-product `is_semi_finished` flag, then the legacy SKU
 * heuristic, then 'finished'.
 */
export function classifyProduct(
  p: Pick<ProductRow, 'product_type' | 'sku' | 'category_type' | 'is_semi_finished'>,
): ProductTypeFilter {
  if (p.product_type === 'combo') return 'combo';

  switch (p.category_type) {
    case 'raw_material':  return 'raw';
    case 'semi_finished': return 'semi-finished';
    case 'finished':      return 'finished';
    default:              break; // category_type missing → fall through
  }

  if (p.is_semi_finished) return 'semi-finished';
  const sku = (p.sku ?? '').toUpperCase();
  if (sku.startsWith('RAW') || sku.startsWith('CON') || sku.startsWith('HAS')) return 'raw';
  if (sku.startsWith('SFG')) return 'semi-finished';
  return 'finished';
}
