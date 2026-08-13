// apps/backoffice/src/features/products/counters.ts
//
// Écran 2a — la DESCRIPTION des compteurs du catalogue, pas leur rendu.
//
// Le rendu est celui de l'archétype LIST (`components/ListCounterStrip`) : il
// n'existe qu'une bande de compteurs dans le back-office, et le catalogue en
// est une instance comme les commandes ou les clients. Ce qui reste propre au
// catalogue est ici : quelles cellules, dans quel ordre, ce qu'elles comptent
// et laquelle désigne un défaut.
//
// Les cinq premières découpent le catalogue par nature ; les deux dernières
// comptent un DÉFAUT — un produit désactivé qu'on a oublié de purger, un
// produit sans prix de revient. Ce sont elles qui justifient la bande : elles
// désignent du travail, là où « 318 produits » n'en désigne aucun.
//
// « No cost price » vire au rouge dès qu'il n'est pas nul, parce qu'un produit
// sans coût n'a pas de marge : il disparaît silencieusement de toute analyse de
// rentabilité. À zéro, il n'y a rien à signaler — la couleur retombe.

import type { ListCounter } from '@/components/ListCounterStrip.js';
import type { ProductCounter, ProductsKpis } from './types.js';

interface Cell {
  id: ProductCounter;
  label: string;
  value: number;
  /** Compteur de défaut : la valeur se lit en rouge dès qu'elle n'est pas nulle. */
  defect?: boolean;
  /** Compteur d'arrière-plan : la valeur se grise. */
  muted?: boolean;
}

/**
 * Construit les compteurs du catalogue.
 *
 * `onSelect` reçoit le compteur demandé ; un second clic sur le compteur actif
 * revient à « all » — sauf sur « all » lui-même, qui est déjà l'absence de
 * filtre et n'a donc rien à défaire.
 */
export function buildProductCounters(
  kpis: ProductsKpis,
  active: ProductCounter,
  onSelect: (next: ProductCounter) => void,
  isLoading = false,
): ListCounter[] {
  const cells: readonly Cell[] = [
    { id: 'all',           label: 'All products',  value: kpis.total },
    { id: 'finished',      label: 'Finished',      value: kpis.finished },
    { id: 'semi-finished', label: 'Semi-finished', value: kpis.semi_finished },
    { id: 'raw',           label: 'Raw materials', value: kpis.raw_material },
    { id: 'combo',         label: 'Combos',        value: kpis.combo },
    { id: 'inactive',      label: 'Inactive',      value: kpis.inactive, muted: true },
    { id: 'no-cost',       label: 'No cost price', value: kpis.no_cost_price, defect: true },
  ];

  return cells.map((c): ListCounter => ({
    id:    c.id,
    label: c.label,
    // Un chargement rend un tiret, jamais un zéro : « 0 produit sans coût » et
    // « je ne sais pas encore » ne se ressemblent pas.
    value: isLoading ? '—' : c.value.toLocaleString('id-ID'),
    ...(isLoading || c.muted === true ? { muted: true } : {}),
    ...(!isLoading && c.defect === true && c.value > 0 ? { tone: 'danger' as const } : {}),
    onSelect: () => { onSelect(active === c.id && c.id !== 'all' ? 'all' : c.id); },
  }));
}
