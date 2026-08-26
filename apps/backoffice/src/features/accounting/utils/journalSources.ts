// apps/backoffice/src/features/accounting/utils/journalSources.ts
//
// Les familles d'émetteurs d'écritures (`journal_entries.reference_type`) et
// leur libellé. La colonne est du texte libre côté schéma ; la liste ci-dessous
// est le relevé EXHAUSTIF des valeurs vivantes au 2026-08-26 — les douze
// présentes en base, plus les quatre que les fonctions émettrices écrivent
// (`sale_void`, `cash_movement`, `manual`, `year_close`) sans occurrence encore.
// Un émetteur neuf devra s'ajouter ici pour être filtrable par son nom ; en
// attendant, la page garde la valeur inconnue sélectionnable telle quelle —
// un filtre posé par l'URL ne doit jamais devenir irreprésentable.

export interface JournalSourceOption {
  value: string;
  label: string;
}

export const JOURNAL_SOURCE_OPTIONS: readonly JournalSourceOption[] = [
  { value: 'sale',             label: 'Sale' },
  { value: 'sale_void',        label: 'Sale void' },
  { value: 'sale_refund',      label: 'Sale refund' },
  { value: 'b2b_order',        label: 'B2B order' },
  { value: 'b2b_payment',      label: 'B2B payment' },
  { value: 'b2b_adjustment',   label: 'B2B adjustment' },
  { value: 'purchase',         label: 'Purchase' },
  { value: 'purchase_payment', label: 'Purchase payment' },
  { value: 'expense',          label: 'Expense' },
  { value: 'expense_payment',  label: 'Expense payment' },
  { value: 'stock_movement',   label: 'Stock movement' },
  { value: 'production',       label: 'Production' },
  { value: 'shift_close',      label: 'Shift close' },
  { value: 'cash_movement',    label: 'Cash movement' },
  { value: 'manual',           label: 'Manual entry' },
  { value: 'year_close',       label: 'Year close' },
];
