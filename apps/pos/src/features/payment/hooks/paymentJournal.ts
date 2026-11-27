// Détail de règlement porté par le journal POS (payment_started / payment_completed).
// Journal 2026-11-26 : un split n'y apparaissait que sous son premier moyen, alors
// que la base enregistrait bien chaque règlement — le rapprochement lu depuis le
// journal en devenait faux. `method` reste écrit à côté pour la lecture historique.
import type { Tender } from '@breakery/domain';

export interface PaymentJournalDetail {
  split: { method: string; amount: number }[];
  /** Ardoise : le montant journalisé est l'encaissé (souvent 0) ; le reste dû se lit ici. */
  outstanding_due?: number;
}

export function paymentJournalDetail(tenders: Tender[], outstandingDue?: number): PaymentJournalDetail {
  return {
    split: tenders.map((t) => ({ method: t.method, amount: t.amount })),
    ...(outstandingDue !== undefined ? { outstanding_due: outstandingDue } : {}),
  };
}
