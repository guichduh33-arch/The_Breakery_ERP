// apps/backoffice/src/features/dashboard/utils/dayState.ts
//
// Écran 1c — l'état « la journée n'a pas commencé ».
//
// À 07:10, la boulangerie n'a encore rien vendu. Le RPC répond honnêtement 0
// partout, et la bande KPI en tirait sept « ▼ down 100,0% versus yest » : un mur
// de rouge, chaque matin, à l'ouverture. Aucun de ces sept signaux n'est faux au
// sens arithmétique et tous sont faux au sens métier — la journée n'a pas
// baissé de 100 %, elle n'a pas encore eu lieu.
//
// Deux points de méthode :
//
//  · La détection se lit dans la donnée DÉJÀ chargée — le compte de commandes du
//    jour. Aucune requête de plus : un état d'affichage ne justifie pas un
//    aller-retour réseau.
//  · `null` n'est PAS zéro. Une valeur absente veut dire « on ne sait pas » et
//    ne déclenche rien : c'est la règle qui traverse tout ce module
//    (`format.ts`), et la confondre avec 0 rendrait la panne indiscernable du
//    petit matin.

import type { DashboardKpis } from '../hooks/useDashboardOverview.js';

/**
 * Mention posée sous la bande à la place des sept comparaisons. Une phrase, une
 * seule : sept fois « pas de comparaison » serait le même mur, en gris.
 */
export const NO_SALES_YET_NOTE =
  'No sales recorded yet today — comparisons resume with the first sale.';

/**
 * Vrai quand le jour métier courant ne porte AUCUNE commande, donc aucune base
 * de comparaison. Faux dès qu'une vente est enregistrée, et faux aussi quand le
 * compte est inconnu (`null`) — voir l'en-tête.
 */
export function hasNoSalesYetToday(kpis: DashboardKpis | null): boolean {
  return kpis !== null && kpis.orders.value === 0;
}

/**
 * Le symétrique de `hasNoSalesYetToday` : la journée EN COURS a vendu, mais la
 * période COMPARÉE, elle, était vide. Le RPC répond alors `null` sur les six
 * comparaisons de ce créneau (`_pct_change` refuse de diviser par zéro), et la
 * bande rendait six tirets côte à côte — le même mur qu'à l'ouverture, décalé
 * d'une colonne.
 *
 * Le test est STRICT : on ne replie la colonne que si TOUTES les comparaisons
 * du créneau sont absentes. Une seule mesure sans base (la marge, quand le net
 * est négatif) reste un tiret dans sa tuile : c'est un fait sur cette mesure-là,
 * pas sur la période.
 */
export function hasNoComparisonBase(
  kpis: DashboardKpis | null,
  slot: 'yesterday' | 'd7',
): boolean {
  if (kpis === null) return false;
  const deltas =
    slot === 'yesterday'
      ? [
          kpis.net_revenue.vs_yesterday,
          kpis.orders.vs_yesterday,
          kpis.customers.vs_yesterday,
          kpis.items_sold.vs_yesterday,
          kpis.avg_basket.vs_yesterday,
          kpis.gross_margin.vs_yesterday_pt,
        ]
      : [
          kpis.net_revenue.vs_d7,
          kpis.orders.vs_d7,
          kpis.customers.vs_d7,
          kpis.items_sold.vs_d7,
          kpis.avg_basket.vs_d7,
          kpis.gross_margin.vs_d7_pt,
        ];
  return deltas.every((d) => d === null);
}

/**
 * Mention unique qui remplace la (ou les) colonne(s) de comparaison repliée(s).
 * `null` quand il n'y a rien à dire — les deux bases existent.
 */
export function noBaselineNote(noYesterday: boolean, noD7: boolean): string | null {
  if (noYesterday && noD7) {
    return 'No sales yesterday or on the same weekday last week — no comparison available.';
  }
  if (noYesterday) return 'No sales yesterday — the day-on-day comparison is unavailable.';
  if (noD7) {
    return 'No sales on the same weekday last week — the week-on-week comparison is unavailable.';
  }
  return null;
}
