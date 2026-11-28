// La pastille de PAIEMENT d'un bon de commande — un seul rendu partout.
//
// Avant, deux pastilles disaient deux choses : la fiche du bon écrivait
// « PAID / PARTIAL / UNPAID » d'après le grand livre, la fiche fournisseur
// écrivait « awaiting receipt » pour tout bon non reçu, même déjà payé. Le même
// bon avait donc deux statuts de paiement selon la page. La règle commune : le
// statut de paiement se lit dans le grand livre `purchase_payments`, quel que
// soit l'état de la réception (les deux axes sont indépendants). La dette
// fournisseur, elle, ne compte que les bons reçus : c'est la tuile « Unpaid »,
// pas cette pastille.

import type { JSX } from 'react';
import { Badge } from '@breakery/ui';
import { derivePaymentStatus, type PoPaymentStatus } from '../hooks/usePoPayments.js';

export const PAYMENT_STATUS_LABELS: Record<PoPaymentStatus, string> = {
  unpaid:  'Unpaid',
  partial: 'Partly paid',
  paid:    'Paid',
};

const PAYMENT_STYLES: Record<PoPaymentStatus, string> = {
  paid:    'border-success text-success',
  partial: 'border-warning text-warning',
  unpaid:  'border-danger text-danger',
};

export function PaymentStatusBadge({ status }: { status: PoPaymentStatus }): JSX.Element {
  return (
    <Badge variant="outline" data-payment-status={status}
      className={`whitespace-nowrap uppercase tracking-widest ${PAYMENT_STYLES[status]}`}>
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export interface PoPaymentBadgeProps {
  status:             string;
  totalAmount:        number | string | null;
  paidAmount:         number;
  isHistoricalImport: boolean;
}

/** Statut de paiement d'un bon, ou rien quand il n'en a pas. */
export function poPaymentStatusOf(p: PoPaymentBadgeProps): PoPaymentStatus | 'none' | 'imported' {
  if (p.status === 'cancelled') return 'none';
  if (p.isHistoricalImport) return 'imported';
  return derivePaymentStatus(p.paidAmount, Number(p.totalAmount ?? 0));
}

export function PoPaymentBadge(props: PoPaymentBadgeProps): JSX.Element {
  const s = poPaymentStatusOf(props);
  if (s === 'none') {
    return <span className="text-text-muted" aria-label="No payment status — order cancelled">—</span>;
  }
  if (s === 'imported') {
    // Un import historique est hors encours : on le dit au lieu de « Unpaid ».
    return <Badge variant="outline" className="uppercase tracking-widest text-text-muted">Imported</Badge>;
  }
  return <PaymentStatusBadge status={s} />;
}
