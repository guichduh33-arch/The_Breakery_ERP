// apps/pos/src/features/stock/wasteReasons.ts
//
// S1-18 — liste fermée des motifs de perte, côté POS (pertes vitrine et
// comptage de fin de journée). Le POS ne peut pas importer le back-office :
// ce fichier reprend les mêmes libellés anglais que celui du back-office.
//
// Les VALEURS viennent de l'enum Postgres `waste_reason` via les types générés :
// aucun littéral n'est inventé ici. Le `Record<WasteReason, string>` force le
// typecheck à casser si une valeur est ajoutée ou retirée côté base.

import type { Database } from '@breakery/supabase';

export type WasteReason = Database['public']['Enums']['waste_reason'];

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

/** Motif dont la note est obligatoire (règle serveur). */
export const NOTE_REQUIRED_REASON: WasteReason = 'other';
export const MIN_WASTE_NOTE = 3;
export const MAX_WASTE_NOTE = 2000;

export function isWasteReason(value: unknown): value is WasteReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WASTE_REASON_LABELS, value);
}

/** Motif choisi pour une perte : un code de la liste et une note facultative. */
export interface WasteChoice {
  reason: WasteReason;
  note: string;
}

/**
 * Même règle que le serveur : une note présente compte au moins trois
 * caractères, et le motif `other` exige une note.
 */
export function isValidWasteNote(reason: WasteReason, note: string): boolean {
  const trimmed = note.trim();
  if (trimmed.length > MAX_WASTE_NOTE) return false;
  if (trimmed === '') return reason !== NOTE_REQUIRED_REASON;
  return trimmed.length >= MIN_WASTE_NOTE;
}

/**
 * Motif connu par son seul texte (comptage enregistré) : le serveur y écrit la
 * note, ou le code quand il n'y a pas de note. Un code reconnu prend son
 * libellé ; tout autre texte (note, ou ancien texte libre) s'affiche tel quel.
 */
export function wasteReasonTextLabel(text: string): string {
  const trimmed = text.trim();
  return isWasteReason(trimmed) ? WASTE_REASON_LABELS[trimmed] : text;
}
