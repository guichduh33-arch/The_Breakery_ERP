// apps/backoffice/src/features/inventory-production/wasteReasons.ts
//
// ADR-008 D3 — libellés d'affichage des causes de raté de production.
//
// Les VALEURS viennent de l'enum Postgres `waste_reason` via les types générés :
// aucun littéral n'est inventé ici. Le `Record<WasteReason, string>` force le
// typecheck à casser si une valeur est ajoutée ou retirée côté base, ce qui
// interdit le décalage silencieux entre l'enum et le menu déroulant.

import type { WasteReason } from './hooks/useRecordProduction.js';

export const WASTE_REASON_LABELS: Record<WasteReason, string> = {
  mis_baked:     'Mis-baked',
  poor_proofing: 'Poor proofing',
  cosmetic:      'Cosmetic defect',
  demo:          'Demonstration',
  recipe_test:   'Recipe test',
  tasting:       'Tasting',
};

/** Ordre d'affichage du menu déroulant. */
export const WASTE_REASON_OPTIONS = Object.keys(WASTE_REASON_LABELS) as WasteReason[];

export function isWasteReason(value: string): value is WasteReason {
  return Object.prototype.hasOwnProperty.call(WASTE_REASON_LABELS, value);
}
