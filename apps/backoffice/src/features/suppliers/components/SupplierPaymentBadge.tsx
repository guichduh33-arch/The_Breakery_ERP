// apps/backoffice/src/features/suppliers/components/SupplierPaymentBadge.tsx
//
// S3-07 — Badge de paiement d'un bon sur la fiche fournisseur, dérivé du grand
// livre `purchase_payments` (même dérivation que la fiche du bon :
// `derivePaymentStatus`), sur les seuls bons reçus, comme la tuile et le rapport.
// Les conditions de paiement n'y entrent plus. Un bon annulé n'a pas de statut de paiement ; un import
// historique est hors encours dans le rapport, on le dit au lieu d'afficher
// « unpaid ».

import type { JSX } from 'react';
import { Badge } from '@breakery/ui';
import { derivePaymentStatus } from '@/features/purchasing/hooks/usePoPayments.js';

export interface SupplierPaymentBadgeProps {
  status:               string;
  total_amount:         number | string | null;
  paid_amount:          number;
  is_historical_import: boolean;
}

export function SupplierPaymentBadge({ row }: { row: SupplierPaymentBadgeProps }): JSX.Element {
  if (row.status === 'cancelled') {
    return <span className="text-text-muted" aria-label="No payment status">—</span>;
  }
  if (row.is_historical_import) {
    return <Badge variant="outline" className="text-text-muted">imported</Badge>;
  }
  // Même règle que la tuile « Unpaid » et le rapport des paiements : seul un bon
  // reçu porte une dette. Avant réception, on ne dit ni « unpaid » ni « partial ».
  if (row.status !== 'received') {
    return <Badge variant="outline" className="text-text-muted">awaiting receipt</Badge>;
  }
  const status = derivePaymentStatus(row.paid_amount, Number(row.total_amount ?? 0));
  if (status === 'paid') {
    return <Badge variant="outline" className="border-success text-success">paid</Badge>;
  }
  if (status === 'partial') {
    return <Badge variant="outline" className="border-warning text-warning">partial</Badge>;
  }
  return <Badge variant="outline" className="border-danger text-danger">unpaid</Badge>;
}
