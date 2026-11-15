// Indices de contrôle, jamais verdicts de fraude. Aucun comptage global depuis une page partielle :
// ce fichier juge UNE ligne. Les répétitions se comptent dans auditSignals, sur la période entière.
import type { AuditLogRow } from '../hooks/useAuditLogs.js';
import { auditRecord, auditNumber } from './auditValues.js';

export type AuditSeverity = 'high' | 'medium' | 'low';

export interface AuditThresholds {
  /** Écart de caisse au-delà duquel le signal est fort (IDR), comme la règle de clôture du POS. */
  varianceAbs: number;
  /** Part de varianceAbs à partir de laquelle le signal est moyen. */
  varianceMediumShare: number;
  /** Variation de coût recalculé en dessous de laquelle la ligne est du bruit. */
  costChangeLow: number;
  costChangeMedium: number;
  /** Fenêtre de répétition, en minutes. */
  repeatWindowMinutes: number;
  reprintRepeatMedium: number;
  reprintRepeatHigh: number;
  paymentFailRepeatMedium: number;
  paymentFailRepeatHigh: number;
  pinFailRepeatHigh: number;
}

// Valeurs par défaut. varianceAbs suit le réglage `shift_variance_threshold_abs` quand il est lisible.
export const DEFAULT_AUDIT_THRESHOLDS: AuditThresholds = {
  varianceAbs: 50_000,
  varianceMediumShare: 0.1,
  costChangeLow: 0.05,
  costChangeMedium: 0.2,
  repeatWindowMinutes: 10,
  reprintRepeatMedium: 2,
  reprintRepeatHigh: 3,
  paymentFailRepeatMedium: 2,
  paymentFailRepeatHigh: 3,
  pinFailRepeatHigh: 3,
};

const VARIANCE_KEYS = ['variance', 'variance_card', 'variance_qris'] as const;

/** Plus grand écart de clôture, en valeur absolue ; null si aucun écart chiffré. */
export function auditMaxVariance(row: AuditLogRow): number | null {
  if (row.action !== 'shift.close') return null;
  const context = auditRecord(row.metadata);
  const values = VARIANCE_KEYS.map((key) => auditNumber(context[key])).filter((v): v is number => v !== null);
  return values.length ? Math.max(...values.map(Math.abs)) : null;
}

/**
 * Vrai forçage de stock négatif. Une entrée de production porte toujours le
 * drapeau d'autorisation : seule une entrée qui finit sous zéro est un forçage.
 */
export function auditNegativeStockOverride(row: AuditLogRow): boolean {
  const context = auditRecord(row.metadata);
  if (context.force_negative !== true && context.allow_negative !== true) return false;
  if (row.action !== 'stock.movement') return true;
  const endStock = auditNumber(context.new_current_stock);
  if (endStock !== null) return endStock < 0;
  return context.movement_type !== 'production_in';
}

/** Variation relative d'un coût recalculé ; null si elle ne se calcule pas. */
export function auditCostChange(row: AuditLogRow): number | null {
  if (row.action !== 'product.cost_recomputed') return null;
  const context = auditRecord(row.metadata);
  const before = auditNumber(context.old_cost);
  const after = auditNumber(context.new_cost);
  if (before === null || after === null || before === 0) return null;
  return Math.abs(after / before - 1);
}

const ACCESS_CHANGE = /^(role\.|user\.(role_change|permission_override)|lan\.device\.(issue|permissions))/;
const SENSITIVE = /^(order\.(cancel|refund|void)|pos\.(item_voided|paid_out)|production\.revert|display\.(waste|adjust|day_count_corrected)|loyalty\.adjust|customer\.store_credit_granted|product\.cost_corrected)/;

export function auditReviewCue(row: AuditLogRow): string | null {
  const context = auditRecord(row.metadata);
  const details = auditRecord(row.payload);
  if (row.action === 'login.failed') return 'Verify repeated attempts against this account; the person attempting sign-in is unknown.';
  if (row.action === 'manager_pin.failed') return 'Manager authorisation failed. Check repeated attempts and the requested operation.';
  if (ACCESS_CHANGE.test(row.action)) {
    return 'Access rights changed. Verify the recipient, permission and business justification.';
  }
  const variance = auditMaxVariance(row);
  if (variance !== null && variance !== 0) return 'Register discrepancy recorded. Compare the count, expected balance and approval.';
  if (row.action === 'expense.approved_step' && context.self_approval === true) {
    return 'Self-approval exception recorded. Verify the approver and approval step.';
  }
  if (row.action === 'pos.cash_drawer_opened' && details.trigger === 'manual') {
    return 'Manual drawer request. Verify its purpose and the related cash movement.';
  }
  if (row.action === 'pos.receipt_reprinted') return 'Receipt reprint request. Compare with the original payment and other copies.';
  if (row.action === 'pos.payment_failed') return 'Payment attempt rejected. Check the failure code and whether the sale was completed afterwards.';
  if (row.action === 'shift.cash_movement' && context.direction === 'out') return 'Cash withdrawal recorded. Verify the reason, accounting counterpart and supporting record.';
  if (row.action === 'customer.update_credit_terms' || row.action.startsWith('customer_price.')) return 'Customer terms changed. Verify the approved price or credit limit.';
  if (auditNegativeStockOverride(row)) return 'Negative stock override recorded. Verify the authorisation and stock reconciliation.';
  if (SENSITIVE.test(row.action)) {
    return 'Sensitive adjustment. Verify the reason, supporting record and authorisation.';
  }
  if (row.action === 'pos.offline_intent_quarantined') return 'Offline operation was isolated. Check reconciliation before retrying a payment.';
  return null;
}

/** Gravité d'UNE ligne, sans tenir compte des répétitions. */
export function auditRowSeverity(row: AuditLogRow, thresholds: AuditThresholds = DEFAULT_AUDIT_THRESHOLDS): AuditSeverity | null {
  const context = auditRecord(row.metadata);
  const variance = auditMaxVariance(row);
  if (variance !== null && variance !== 0) {
    if (context.pin_approval_required === true || variance > thresholds.varianceAbs) return 'high';
    return variance >= thresholds.varianceAbs * thresholds.varianceMediumShare ? 'medium' : 'low';
  }
  const costChange = auditCostChange(row);
  if (costChange !== null) {
    if (costChange >= thresholds.costChangeMedium) return 'medium';
    return costChange >= thresholds.costChangeLow ? 'low' : null;
  }
  if (auditReviewCue(row) === null) return null;
  if (row.action === 'login.failed') return (auditNumber(context.attempts) ?? 0) >= 3 ? 'high' : 'medium';
  if (ACCESS_CHANGE.test(row.action) || context.self_approval === true) return 'high';
  if (/^order\.(refund|void)/.test(row.action) || row.action === 'pos.offline_intent_quarantined') return 'high';
  if (row.action === 'pos.receipt_reprinted' || row.action === 'pos.payment_failed') return 'low';
  return 'medium';
}

export function auditSourceLabel(source: string): string {
  return source === 'audit' ? 'Server audit' : source === 'pos' ? 'POS device report' : 'Other recorded source';
}

/** Code court de la nature de la preuve. S serveur, D terminal, T compte visé, U source inconnue. */
export function auditEvidenceCode(row: AuditLogRow): 'S' | 'D' | 'T' | 'U' {
  if (row.action === 'login.failed') return 'T';
  return row.source === 'audit' ? 'S' : row.source === 'pos' ? 'D' : 'U';
}

export function auditEvidenceNote(row: AuditLogRow): string {
  if (row.action === 'login.failed') return 'The named account was targeted. This entry does not identify the person who entered the PIN.';
  if (row.source !== 'audit' && row.source !== 'pos') return 'Source not recognised. Inspect the recorded context before drawing conclusions.';
  return row.source === 'pos'
    ? 'Reported by the device and later synchronised. Confirm payments against the server audit; this entry does not prove physical printing or drawer opening.'
    : 'Recorded by a server operation. This entry records that operation, not the identity or intent of a person using an account.';
}
