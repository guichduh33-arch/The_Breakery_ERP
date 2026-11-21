// apps/backoffice/src/features/orders/refundValidationCopy.ts
//
// Traduction des jetons de `validateRefundDraft` (packages/domain) en phrases
// anglaises lisibles pour la modale de remboursement du BO (audit Sales
// 2026-11-21) : la modale affichait `qty_exceeds_remaining`,
// `tender_method_overflow`… et des UUID de lignes. Même doctrine que
// `VoidOrderModal` : une table locale au geste, aucun jeton brut à l'écran.

import type { RefundValidation } from '@breakery/domain';
import { formatCurrency } from '@breakery/utils';
import { paymentMethodLabel } from './statusMeta.js';

type RefundErrorCode = Extract<RefundValidation, { ok: false }>['error'];

/** `Record` exhaustif : un jeton ajouté au domaine casse le build ici. */
const REFUND_VALIDATION_COPY: Record<RefundErrorCode, string> = {
  no_lines:               'Select at least one line to refund.',
  no_tenders:             'Choose where the money goes back.',
  reason_too_short:       'The reason must be at least 3 characters.',
  unknown_item:           'A selected line no longer belongs to this order. Close and reopen the refund.',
  item_cancelled:         'A selected line was cancelled and cannot be refunded.',
  qty_invalid:            'Quantities must be greater than zero.',
  qty_exceeds_remaining:  'More units are selected than remain to refund.',
  cap_exceeded:           'This refund would exceed what the customer paid for the order.',
  tender_amount_invalid:  'The refund amount must be greater than zero.',
  tender_method_overflow: 'This refund is larger than what remains refundable on the chosen method.',
  tender_sum_mismatch:    'The refund split does not add up to the refund total. Close and reopen the refund.',
};

/** `key=value` séparés par des espaces — le seul format que pose le domaine. */
function detailFields(detail: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (detail ?? '').split(/\s+/)) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/**
 * Phrase affichable d'un refus de validation. `nameOf` résout un id de ligne
 * en nom de produit : l'UUID n'est jamais montré.
 */
export function refundValidationText(
  validation: Extract<RefundValidation, { ok: false }>,
  nameOf: (orderItemId: string) => string | undefined,
): string {
  const base = REFUND_VALIDATION_COPY[validation.error];
  const detail = validation.detail ?? '';
  switch (validation.error) {
    case 'unknown_item':
    case 'item_cancelled':
    case 'qty_invalid': {
      const name = nameOf(detail);
      return name ? `${base} (${name})` : base;
    }
    case 'qty_exceeds_remaining': {
      const [itemId = ''] = detail.split(/\s+/);
      const max = detailFields(detail).max;
      const name = nameOf(itemId);
      if (name && max !== undefined) return `${name}: only ${max} left to refund.`;
      return name ? `${base} (${name})` : base;
    }
    case 'tender_method_overflow': {
      const f = detailFields(detail);
      const avail = Number(f.avail);
      if (f.method && Number.isFinite(avail)) {
        return `${paymentMethodLabel(f.method)} has only ${formatCurrency(avail)} left to refund.`;
      }
      return base;
    }
    default:
      return base;
  }
}

export interface RefundBlockerFacts {
  allowed: boolean;
  busy: boolean;
  pending: boolean;
  hasLines: boolean;
  pointsOnly: boolean;
  hasDestination: boolean;
  reasonOk: boolean;
  pinOk: boolean;
  /** Le refus de validation est déjà affiché à part : on ne le répète pas. */
  validationShown: boolean;
}

/**
 * Ce qui manque pour valider, en une phrase — ou `null` si rien ne manque
 * (ou si un autre message l'explique déjà). Ordre = ordre de l'écran.
 */
export function refundBlocker(f: RefundBlockerFacts): string | null {
  if (f.busy) return null;
  if (!f.allowed) return 'You need the refund permission to continue.';
  if (f.pending) return f.pinOk ? null : 'Enter the 6-digit manager PIN to check the pending refund.';
  if (!f.hasLines) return 'Select at least one line to refund.';
  if (!f.pointsOnly && !f.hasDestination) return 'Choose a refund destination.';
  if (f.validationShown) return null;
  if (!f.reasonOk) return 'Enter a reason (at least 3 characters).';
  if (!f.pinOk) return 'Enter the 6-digit manager PIN.';
  return null;
}
