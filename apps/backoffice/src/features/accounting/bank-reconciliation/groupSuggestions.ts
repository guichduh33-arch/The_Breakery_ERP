/**
 * Propositions de rapprochement groupé, calculées côté client sur les lignes
 * déjà chargées. Rien n'est posté ici : chaque proposition ouvre le formulaire
 * de comptabilisation, que le serveur revalide au centime et sous PIN.
 *
 * Trois familles, observées sur le relevé Mandiri d'octobre 2026 :
 * - versement QRIS / carte : une ligne nette par canal et par jour, issue des
 *   ventes d'un jour précédent ; le frais réel est l'écart brut − net ;
 * - virement sortant suivi de sa ligne de frais de transfert ;
 * - lignes de frais isolées, sans écriture au grand livre.
 */
import type { BankLine, GlLine } from './contracts.js';
import { decimalCents, decimalText } from './money.js';

export interface ClearingDay {
  entry_date: string; account_id: string; account_code: string; account_name: string;
  line_count: number; gross: string; line_ids: string[] | null;
}
export interface SettlementProposal {
  bankLine: BankLine; day: ClearingDay; fee: string; rateBasisPoints: number; daysAfterSale: number;
  /** Un autre jour de ventes tenait aussi sous le plafond : à vérifier. */
  ambiguous: boolean;
}
export interface TransferFeeProposal { payment: BankLine; feeLine: BankLine; gl: GlLine; fee: string }

/** Plafond d'un frais plausible : au-delà, l'écart n'est pas un frais mais une autre opération. */
export const MAX_SETTLEMENT_RATE_BP = 500;
/** Délai maximal observé entre la vente et le versement. */
export const MAX_SETTLEMENT_DELAY_DAYS = 5;
/** Une ligne de frais de transfert reste petite (2 500 à 19 500 IDR observés). */
export const MAX_TRANSFER_FEE = 50_000n * 100n;

const dayIndex = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const blank = (text: string) => text.replace(/["'\s]/g, '').length === 0;
const FEE_WORDS = /\b(fee|biaya|adm|admin|charge|charges|provisi)\b/i;

/** Frais en points de base (1/100 de %), arrondi. */
export function rateBp(fee: bigint, gross: bigint): number {
  if (gross <= 0n) return 0;
  return Number((fee * 10_000n + gross / 2n) / gross);
}
export const formatRate = (bp: number) => `${(bp / 100).toFixed(2)}%`;

/**
 * Pour chaque versement positif non rapproché, la journée de ventes (compte
 * 1115 ou 1116) dont il est le net. Affectation gloutonne et exclusive : un
 * versement et une journée ne servent qu'une fois, le plus proche dans le temps
 * puis le taux le plus bas l'emportent.
 */
export function proposeSettlements(bankLines: BankLine[], days: ClearingDay[]): SettlementProposal[] {
  const pairs: SettlementProposal[] = [];
  for (const bankLine of bankLines) {
    if (bankLine.match_id) continue;
    const net = decimalCents(bankLine.amount);
    if (net <= 0n) continue;
    for (const day of days) {
      if (!day.line_ids || day.line_ids.length === 0) continue;
      const gross = decimalCents(day.gross);
      const delay = dayIndex(bankLine.transaction_date) - dayIndex(day.entry_date);
      if (gross <= 0n || net > gross || delay < 0 || delay > MAX_SETTLEMENT_DELAY_DAYS) continue;
      const fee = gross - net;
      const bp = rateBp(fee, gross);
      if (bp > MAX_SETTLEMENT_RATE_BP) continue;
      pairs.push({ bankLine, day, fee: decimalText(fee), rateBasisPoints: bp, daysAfterSale: delay, ambiguous: false });
    }
  }
  const fits = new Map<string, number>();
  for (const pair of pairs) fits.set(pair.bankLine.id, (fits.get(pair.bankLine.id) ?? 0) + 1);
  pairs.sort((a, b) => a.daysAfterSale - b.daysAfterSale || a.rateBasisPoints - b.rateBasisPoints
    || a.bankLine.ordinal - b.bankLine.ordinal);
  const usedBank = new Set<string>(); const usedDay = new Set<string>(); const chosen: SettlementProposal[] = [];
  for (const pair of pairs) {
    const dayKey = `${pair.day.entry_date}:${pair.day.account_id}`;
    if (usedBank.has(pair.bankLine.id) || usedDay.has(dayKey)) continue;
    usedBank.add(pair.bankLine.id); usedDay.add(dayKey); chosen.push({ ...pair, ambiguous: (fits.get(pair.bankLine.id) ?? 0) > 1 });
  }
  return chosen.sort((a, b) => a.bankLine.ordinal - b.bankLine.ordinal);
}

const isFeeLine = (line: BankLine) => {
  const amount = decimalCents(line.amount);
  return !line.match_id && amount < 0n && -amount <= MAX_TRANSFER_FEE && (blank(line.description) || FEE_WORDS.test(line.description));
};
/** Une ligne banque dont le montant exact attend au grand livre n'est pas un frais : c'est un paiement. */
const hasOpenLedger = (line: BankLine, glLines: GlLine[]) =>
  glLines.some((gl) => !gl.match_id && decimalCents(gl.amount) === decimalCents(line.amount));

/**
 * Virement sortant dont la ligne voisine du relevé, le même jour, est son
 * frais : le virement a une seule écriture banque non rapprochée de même
 * montant exact. L'ordinal est global (identité) : on prend le voisin dans
 * l'ordre trié du relevé, d'abord le suivant puis le précédent (export inversé).
 */
export function proposeTransferFees(bankLines: BankLine[], glLines: GlLine[]): TransferFeeProposal[] {
  const sorted = [...bankLines].sort((a, b) => a.ordinal - b.ordinal);
  const openGl = glLines.filter((line) => !line.match_id);
  const used = new Set<string>(); const result: TransferFeeProposal[] = [];
  sorted.forEach((payment, index) => {
    const amount = decimalCents(payment.amount);
    if (payment.match_id || amount >= 0n || used.has(payment.id)) return;
    const candidates = openGl.filter((gl) => decimalCents(gl.amount) === amount && !used.has(gl.id));
    if (candidates.length !== 1) return;
    const feeLine = [sorted[index + 1], sorted[index - 1]].find((line) => line && !used.has(line.id)
      && line.transaction_date === payment.transaction_date && isFeeLine(line) && !hasOpenLedger(line, glLines));
    if (!feeLine) return;
    const fee = -decimalCents(feeLine.amount);
    const gl = candidates[0]!;
    used.add(payment.id); used.add(feeLine.id); used.add(gl.id);
    result.push({ payment, feeLine, gl, fee: decimalText(fee) });
  });
  return result;
}

/**
 * Lignes de frais isolées (description vide ou libellé de frais), hors
 * virements déjà proposés et hors lignes dont le montant attend au grand
 * livre : celles-là sont des paiements, les compter en frais doublerait la charge.
 */
export function standaloneFeeLines(bankLines: BankLine[], glLines: GlLine[], exclude: Set<string>): BankLine[] {
  return bankLines.filter((line) => !exclude.has(line.id) && isFeeLine(line) && !hasOpenLedger(line, glLines));
}

/**
 * Action intelligente pour une sélection manuelle : égalité exacte, frais
 * bancaire (banque = grand livre − frais, même sens), ou rien.
 */
export type SelectionVerdict =
  | { kind: 'empty' } | { kind: 'exact' } | { kind: 'fee'; fee: string } | { kind: 'mismatch'; difference: string };
export function selectionVerdict(bankSum: bigint, glSum: bigint, bankCount: number, glCount: number): SelectionVerdict {
  if (bankCount === 0 || glCount === 0) return { kind: 'empty' };
  if (bankSum === glSum) return { kind: 'exact' };
  const fee = glSum - bankSum;
  const sameSign = (bankSum > 0n && glSum > 0n) || (bankSum < 0n && glSum < 0n);
  if (sameSign && fee > 0n) return { kind: 'fee', fee: decimalText(fee) };
  return { kind: 'mismatch', difference: decimalText(bankSum - glSum) };
}
