// packages/domain/src/inventory/purchaseOrderTotals.ts
//
// S3-06 — Totaux d'un bon de commande avec escomptes et frais de livraison.
// Miroir pur de la ventilation serveur (`_po_cost_allocation_v1`,
// `_split_pro_rata_v1`) pour l'aperçu du back-office ; le serveur reste
// l'autorité des montants enregistrés.
//
// Règles :
//   - net de ligne = round(quantité × coût unitaire, 2) − escompte de ligne ;
//   - subtotal = Σ nets ; PPN = round((subtotal − escompte global) × taux, 2) ;
//   - total = subtotal − escompte global + PPN + port (le port n'est pas taxé) ;
//   - escompte global, PPN et port sont répartis au centime par le plus fort
//     reste : la somme des parts égale exactement le montant réparti.
//
// `calculateLandedCostAllocation` (même dossier) répartit en flottants et ne
// garantit pas cette somme exacte : il n'est pas utilisé ici.

export interface PoTotalsLineInput {
  quantity: number;
  unitCost: number;
  /** Escompte de la ligne, en montant. */
  discountAmount?: number;
}

export interface PoTotalsInput {
  lines: readonly PoTotalsLineInput[];
  /** Escompte global, en montant. */
  discountAmount?: number;
  /** Frais de livraison facturés, sans PPN ajoutée. */
  deliveryFee?: number;
  /** Taux de PPN, 0..1. */
  vatRate: number;
  /** PPN déjà enregistrée sur le bon : remplace le calcul par le taux. */
  vatAmount?: number;
}

export interface PoLineAllocation {
  gross: number;
  lineDiscount: number;
  net: number;
  discountShare: number;
  vatShare: number;
  feeShare: number;
  /** Part de la ligne dans le total du bon ; Σ lineTotal = total. */
  lineTotal: number;
}

export interface PoTotals {
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  deliveryFee: number;
  total: number;
  lines: PoLineAllocation[];
}

const toCents = (v: number): number =>
  Number.isFinite(v) ? Math.round(v * 100) : 0;
const fromCents = (c: number): number => c / 100;

/**
 * Répartit `amountCents` au prorata de `weights`, en centimes entiers, par le
 * plus fort reste (ex aequo : rang croissant). Poids négatifs comptés à zéro ;
 * poids tous nuls : parts égales. La somme du résultat vaut `amountCents`.
 */
export function splitProRataCents(amountCents: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError('split_amount_invalid');
  }
  let w = weights.map((x) => BigInt(Math.max(0, Math.round(x))));
  let total = w.reduce((a, b) => a + b, 0n);
  if (total === 0n) {
    w = weights.map(() => 1n);
    total = BigInt(n);
  }
  const amount = BigInt(amountCents);
  const floors = w.map((x) => (amount * x) / total);
  const rests = w.map((x) => (amount * x) % total);
  let leftover = amount - floors.reduce((a, b) => a + b, 0n);
  const order = rests
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = floors.slice();
  for (const { i } of order) {
    if (leftover <= 0n) break;
    out[i] = (out[i] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return out.map((x) => Number(x));
}

/**
 * Valeur d'une réception partielle d'une ligne, en différence cumulée comme
 * receive_purchase_order : la somme des réceptions d'une ligne entièrement
 * reçue égale exactement `share`.
 */
export function receiptShare(share: number, ordered: number, before: number, now: number): number {
  if (!(ordered > 0)) return 0;
  const at = (q: number): number => Math.round((toCents(share) * q) / ordered);
  return fromCents(at(before + now) - at(before));
}

/** Totaux et ventilation par ligne d'un bon, au centime près comme le serveur. */
export function computePurchaseOrderTotals(input: PoTotalsInput): PoTotals {
  const grossC = input.lines.map((l) => toCents(l.quantity * l.unitCost));
  const lineDiscC = input.lines.map((l, i) =>
    Math.min(Math.max(0, toCents(l.discountAmount ?? 0)), grossC[i] ?? 0));
  const netC = grossC.map((g, i) => g - (lineDiscC[i] ?? 0));
  const subtotalC = netC.reduce((a, b) => a + b, 0);
  const discountC = Math.min(Math.max(0, toCents(input.discountAmount ?? 0)), subtotalC);
  const feeC = Math.max(0, toCents(input.deliveryFee ?? 0));
  const rate = Number.isFinite(input.vatRate) ? Math.max(0, input.vatRate) : 0;
  const vatC = input.vatAmount !== undefined
    ? Math.max(0, toCents(input.vatAmount))
    : Math.round((subtotalC - discountC) * rate);

  const discShares = splitProRataCents(discountC, netC);
  const taxableC = netC.map((n, i) => n - (discShares[i] ?? 0));
  const vatShares = splitProRataCents(vatC, taxableC);
  const feeShares = splitProRataCents(feeC, netC);

  return {
    subtotal: fromCents(subtotalC),
    discountAmount: fromCents(discountC),
    vatAmount: fromCents(vatC),
    deliveryFee: fromCents(feeC),
    total: fromCents(subtotalC - discountC + vatC + feeC),
    lines: netC.map((n, i) => ({
      gross: fromCents(grossC[i] ?? 0),
      lineDiscount: fromCents(lineDiscC[i] ?? 0),
      net: fromCents(n),
      discountShare: fromCents(discShares[i] ?? 0),
      vatShare: fromCents(vatShares[i] ?? 0),
      feeShare: fromCents(feeShares[i] ?? 0),
      lineTotal: fromCents(n - (discShares[i] ?? 0) + (vatShares[i] ?? 0) + (feeShares[i] ?? 0)),
    })),
  };
}
