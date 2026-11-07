// Indices de contrôle, jamais verdicts de fraude. Aucun comptage global depuis une page partielle.
import type { AuditLogRow } from '../hooks/useAuditLogs.js';
import { auditRecord, auditNumber } from './auditValues.js';

export function auditReviewCue(row: AuditLogRow): string | null {
  const context = auditRecord(row.metadata);
  const details = auditRecord(row.payload);
  if (row.action === 'login.failed') return 'Verify repeated attempts against this account; the person attempting sign-in is unknown.';
  if (row.action === 'manager_pin.failed') return 'Manager authorisation failed. Check repeated attempts and the requested operation.';
  if (/^(role\.|user\.(role_change|permission_override)|lan\.device\.(issue|permissions))/.test(row.action)) {
    return 'Access rights changed. Verify the recipient, permission and business justification.';
  }
  if (row.action === 'shift.close' && ['variance', 'variance_card', 'variance_qris'].some(key => {
    const value = auditNumber(context[key]);
    return value !== null && value !== 0;
  })) return 'Register discrepancy recorded. Compare the count, expected balance and approval.';
  if (row.action === 'expense.approved_step' && context.self_approval === true) {
    return 'Self-approval exception recorded. Verify the approver and approval step.';
  }
  if (row.action === 'pos.cash_drawer_opened' && details.trigger === 'manual') {
    return 'Manual drawer request. Verify its purpose and the related cash movement.';
  }
  if (row.action === 'pos.receipt_reprinted') return 'Receipt reprint request. Compare with the original payment and other copies.';
  if (row.action === 'shift.cash_movement' && context.direction === 'out') return 'Cash withdrawal recorded. Verify the reason, accounting counterpart and supporting record.';
  if (row.action === 'customer.update_credit_terms' || row.action.startsWith('customer_price.')) return 'Customer terms changed. Verify the approved price or credit limit.';
  if (context.force_negative === true || context.allow_negative === true) return 'Negative stock override recorded. Verify the authorisation and stock reconciliation.';
  if (/^(order\.(cancel|refund|void)|pos\.(item_voided|paid_out)|production\.revert|display\.(waste|adjust|day_count_corrected)|loyalty\.adjust|customer\.store_credit_granted|product\.cost_corrected)/.test(row.action)) {
    return 'Sensitive adjustment. Verify the reason, supporting record and authorisation.';
  }
  if (row.action === 'pos.offline_intent_quarantined') return 'Offline operation was isolated. Check reconciliation before retrying a payment.';
  return null;
}

export function auditSourceLabel(source: string): string {
  return source === 'audit' ? 'Server audit' : source === 'pos' ? 'POS device report' : 'Other recorded source';
}

export function auditEvidenceNote(row: AuditLogRow): string {
  if (row.action === 'login.failed') return 'The named account was targeted. This entry does not identify the person who entered the PIN.';
  if (row.source !== 'audit' && row.source !== 'pos') return 'Source not recognised. Inspect the recorded context before drawing conclusions.';
  return row.source === 'pos'
    ? 'Reported by the device and later synchronised. Confirm payments against the server audit; this entry does not prove physical printing or drawer opening.'
    : 'Recorded by a server operation. This entry records that operation, not the identity or intent of a person using an account.';
}
