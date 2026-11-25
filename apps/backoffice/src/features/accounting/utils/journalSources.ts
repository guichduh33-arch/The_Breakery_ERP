// apps/backoffice/src/features/accounting/utils/journalSources.ts
//
// Les familles d'émetteurs d'écritures (`journal_entries.reference_type`) et
// leur libellé. Le schéma borne la colonne par la contrainte
// `journal_entries_reference_type_check`, qui admet d'autres valeurs encore ;
// la liste ci-dessous ne retient que les familles relevées comme émises. Relevé initial du 2026-08-26 (valeurs présentes en base et valeurs
// écrites par les fonctions émettrices), complété le 2026-11-25 par les deux
// familles de l'ADR-047 : `fixed_asset_depreciation` (dotation mensuelle) et
// `fixed_asset_disposal` (sortie d'un équipement).
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
  { value: 'fixed_asset_depreciation', label: 'Depreciation' },
  { value: 'fixed_asset_disposal',     label: 'Asset disposal' },
];
