// S67 (fiche 12 D2.3) — grille de coupures IDR pour l'ouverture/clôture de
// caisse. LISTE CANONIQUE : miroir exact de l'allowlist de close_shift_v5
// (migration 20260710000126) — toute évolution se fait dans les deux.

export const IDR_DENOMINATIONS: readonly number[] = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
];

const KNOWN = new Set(IDR_DENOMINATIONS.map(String));

/** Somme valeur faciale × quantité. Les clés inconnues sont ignorées (la
 *  validation est le rôle d'isValidDenominationGrid / du RPC). */
export function sumDenominations(grid: Record<string, number>): number {
  return Object.entries(grid).reduce(
    (sum, [face, qty]) => (KNOWN.has(face) ? sum + Number(face) * qty : sum),
    0,
  );
}

/** True si toutes les clés sont des coupures connues et toutes les quantités
 *  des entiers >= 0 (miroir de la validation serveur invalid_denomination). */
export function isValidDenominationGrid(grid: Record<string, number>): boolean {
  return Object.entries(grid).every(
    ([face, qty]) => KNOWN.has(face) && Number.isInteger(qty) && qty >= 0,
  );
}
