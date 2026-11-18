// apps/backoffice/src/features/suppliers/utils/supplierOutstanding.ts
//
// S3-07 — « Combien je dois à ce fournisseur » : une seule règle, celle du
// rapport des paiements fournisseurs (RPC `get_supplier_payments`, CTE
// `open_po` / `open_bal`). Un bon compte s'il est reçu (`status = 'received'`),
// non supprimé et hors import historique ; son encours vaut
// `total_amount − Σ purchase_payments.amount`, retenu seulement s'il est > 0.
// Les conditions de paiement (`payment_terms`) n'entrent PAS dans la règle :
// un bon à crédit reçu et jamais payé est dû, c'est le cas que l'ancienne
// heuristique comptait « payé ».
//
// Fonctions pures : pas de React, pas de Supabase.

export interface SupplierLedgerPo {
  status:               string;
  total_amount:         number | string | null;
  is_historical_import: boolean;
  deleted_at:           string | null;
  /** Σ purchase_payments.amount pour ce bon (0 si aucun paiement). */
  paid_amount:          number;
}

export interface SupplierOutstandingSummary {
  /** Somme des encours positifs — doit égaler `outstanding_total` du rapport. */
  outstanding:  number;
  /** Nombre de bons avec un encours > 0 — `open_po_count` du rapport. */
  openPoCount:  number;
  /** Σ des paiements enregistrés sur les bons non supprimés du fournisseur. */
  totalPaid:    number;
}

/** Encours d'un bon selon la règle du rapport ; 0 s'il n'est pas éligible. */
export function poOutstanding(po: SupplierLedgerPo): number {
  if (po.status !== 'received') return 0;
  if (po.deleted_at !== null) return 0;
  if (po.is_historical_import) return 0;
  const balance = Number(po.total_amount ?? 0) - po.paid_amount;
  return balance > 0 ? balance : 0;
}

export function computeSupplierOutstanding(
  pos: readonly SupplierLedgerPo[],
): SupplierOutstandingSummary {
  let outstanding = 0;
  let openPoCount = 0;
  let totalPaid = 0;
  for (const po of pos) {
    const due = poOutstanding(po);
    if (due > 0) {
      outstanding += due;
      openPoCount += 1;
    }
    if (po.deleted_at === null) totalPaid += po.paid_amount;
  }
  return { outstanding, openPoCount, totalPaid };
}

/** Σ des montants d'un embed PostgREST `purchase_payments(amount)`. */
export function sumPayments(payments: readonly { amount: number | string | null }[] | null): number {
  if (payments === null) return 0;
  return payments.reduce((acc, p) => acc + Number(p.amount ?? 0), 0);
}
