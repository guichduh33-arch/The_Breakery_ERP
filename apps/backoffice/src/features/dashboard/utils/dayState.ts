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
