// Pièces de présentation communes au rapprochement bancaire : fil d'Ariane,
// pastille d'état, en-têtes de table. Présentation seulement, aucune donnée.
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/** Libellé mono en capitales — rôle `label` de DESIGN.md (en-têtes de table, repères). */
export const BANK_LABEL = 'font-data text-xs font-semibold uppercase tracking-[0.14em] text-text-muted';
/** En-tête de table : papier inerte, libellé mono, cellule 14/10. */
export const BANK_TH = `${BANK_LABEL} bg-surface-inert px-3.5 py-2.5 text-left`;
export const BANK_TD = 'px-3.5 py-2.5 align-top';

export function BankBreadcrumb({ current }: { current?: ReactNode }) {
  return <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
    <span>Finance</span>
    <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
    {current ? <><span>Bank reconciliation</span><ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
      <span className="font-data text-text-secondary">{current}</span></> : <span className="text-text-secondary">Bank reconciliation</span>}
  </nav>;
}

/** Pastille d'état : contour et texte de la couleur d'état, jamais d'aplat. */
export function BankStatus({ finalized }: { finalized: boolean }) {
  return <span className={`inline-flex h-6 items-center rounded-sm border px-2 ${BANK_LABEL} ${finalized ? 'border-success text-success' : 'border-warning text-warning'}`}>
    {finalized ? 'Finalized' : 'Draft'}</span>;
}
