import { formatQuantity } from '@breakery/utils';

/** Le ledger accepte trois décimales, y compris pour les articles à la pièce. */
export function formatStockQuantity(value: number, unit?: string | null): string {
  const suffix = unit?.trim();
  return `${formatQuantity(value, null)}${suffix ? ` ${suffix}` : ''}`;
}

/** Une valeur vide n'est jamais un comptage à zéro. Aucune troncature silencieuse. */
export function parseStockQuantity(input: string): number | null {
  if (input.trim() === '') return null;
  const quantity = Number(input);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 9_999_999.999) return null;
  const rounded = Math.round(quantity * 1000) / 1000;
  if ((rounded === 0 && quantity !== 0) || Math.abs(quantity - rounded) > 1e-10) return null;
  return rounded;
}
