// apps/backoffice/src/features/purchasing/components/POStatusBadge.tsx
//
// La pastille de RÉCEPTION d'un bon de commande — l'unique rendu du statut,
// partout où un bon apparaît (liste, fiche, fournisseur, article, rapports).
//
// Le statut d'un bon ne dit QUE la réception : un bon « Received » peut n'être
// pas payé, un bon « To receive » peut être déjà payé. Le paiement a sa propre
// pastille (`PoPaymentBadge`). D'où les libellés : « Pending » laissait croire à
// une attente de validation ou de paiement ; « To receive » et « Partly
// received » nomment ce qu'on attend. Les valeurs Postgres ne changent pas.

import type { JSX } from 'react';
import type { POStatus } from '../hooks/usePurchaseOrdersList.js';

const STYLES: Record<POStatus, string> = {
  draft:     'bg-bg-overlay text-text-secondary border-border-subtle',
  pending:   'bg-warning-soft text-warning border-warning',
  partial:   'bg-info-soft text-info border-info',
  received:  'bg-success-soft text-success border-success',
  cancelled: 'bg-danger-soft text-danger border-danger',
};

export const PO_STATUS_LABELS: Record<POStatus, string> = {
  draft:     'Draft',
  pending:   'To receive',
  partial:   'Partly received',
  received:  'Received',
  cancelled: 'Cancelled',
};

function isPoStatus(s: string): s is POStatus {
  return Object.prototype.hasOwnProperty.call(STYLES, s);
}

// `string` : le statut arrive tel que PostgREST le rend ; `isPoStatus` le
// rétrécit avant de lire les tables.
export function POStatusBadge({ status }: { status: string }): JSX.Element {
  // Une valeur inconnue s'affiche telle quelle, en neutre : mieux qu'un écran
  // blanc si la base gagne un statut avant le client.
  const known = isPoStatus(status);
  return (
    <span
      data-status={status}
      className={`inline-flex items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs uppercase tracking-widest ${known ? STYLES[status] : STYLES.draft}`}
    >
      {known ? PO_STATUS_LABELS[status] : status}
    </span>
  );
}
