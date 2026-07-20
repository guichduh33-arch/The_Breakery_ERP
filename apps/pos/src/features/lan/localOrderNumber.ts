// apps/pos/src/features/lan/localOrderNumber.ts
// Spec 006x §4.3 — numérotation LOCALE des commandes hors-ligne : préfixe
// `L-` + compteur par terminal. La collision entre terminaux est impossible
// au replay (l'identité serveur est le client_uuid, pas ce numéro) — le
// numéro local sert l'affichage KDS/KOT/display pendant la coupure.

const STORAGE_KEY = 'breakery-local-order-seq';

export function nextLocalOrderNumber(storage: Storage = localStorage): string {
  let seq = 0;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    seq = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    // Storage inaccessible — on numérote quand même (compteur volatile).
  }
  seq += 1;
  try {
    storage.setItem(STORAGE_KEY, String(seq));
  } catch { /* best effort */ }
  return `L-${seq}`;
}
