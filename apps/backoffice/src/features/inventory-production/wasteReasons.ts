// apps/backoffice/src/features/inventory-production/wasteReasons.ts
//
// ADR-008 D3 — libellés d'affichage des causes de raté de production.
// S1-18 — la même liste fermée sert aussi aux pertes de stock et de vitrine :
// ce fichier est la source unique des libellés de motif du back-office.
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
  expired:       'Expired',
  leftover:      'Leftover',
  damaged:       'Damaged',
  other:         'Other',
};

/** Ordre d'affichage du menu déroulant. */
export const WASTE_REASON_OPTIONS = Object.keys(WASTE_REASON_LABELS) as WasteReason[];

export function isWasteReason(value: string): value is WasteReason {
  return Object.prototype.hasOwnProperty.call(WASTE_REASON_LABELS, value);
}

/** Libellé d'une perte sans motif : déclarée avant la liste fermée. */
export const UNSPECIFIED_WASTE_REASON_LABEL = 'Unspecified';

/**
 * Motif d'une perte tel qu'affiché : libellé de la liste, suivi de la note
 * quand elle diffère du code. Sans code (ligne ancienne), « Unspecified » et
 * l'ancien texte libre reste visible.
 */
export function formatWasteReason(code: WasteReason | null, text: string | null): string {
  const note = text?.trim() ?? '';
  const label = code === null ? UNSPECIFIED_WASTE_REASON_LABEL : WASTE_REASON_LABELS[code];
  return note === '' || note === code ? label : `${label} · ${note}`;
}

/**
 * Motif connu par son seul texte (comptage de vitrine) : le serveur y écrit la
 * note, ou le code quand il n'y a pas de note. Un code reconnu prend son
 * libellé ; tout autre texte s'affiche tel quel.
 */
export function wasteReasonTextLabel(text: string): string {
  const trimmed = text.trim();
  return isWasteReason(trimmed) ? WASTE_REASON_LABELS[trimmed] : text;
}
