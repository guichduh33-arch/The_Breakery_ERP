// apps/backoffice/src/features/expenses/components/ExpenseCategoryHistory.tsx
//
// Archétype 4 (Form) — le volet « historique comparable » du rail de
// conséquence. Sans lui, « Rp 4,850,000 » ne se compare à rien : l'opérateur ne
// sait pas si le montant qu'il engage est la routine du mois ou une anomalie.
//
// Le composant n'est monté QUE lorsqu'une catégorie est choisie (cf.
// ExpenseConsequenceRail) : la requête est alors bornée par `categoryId`, et
// aucune lecture n'est déclenchée tant que le champ est vide.

import type { JSX } from 'react';
import { formatCurrency } from '@breakery/utils';
import { SectionLabel } from '@/components/SectionLabel.js';
import { useExpensesList, useExpenseCategories } from '../hooks/useExpensesList.js';

/** Nombre de lignes montrées — assez pour situer un montant, pas un journal. */
const HISTORY_ROWS = 5;

export interface ExpenseCategoryHistoryProps {
  categoryId: string;
}

export function ExpenseCategoryHistory({
  categoryId,
}: ExpenseCategoryHistoryProps): JSX.Element {
  const { data, isLoading, isError } = useExpensesList({ categoryId });
  // Même queryKey que le sélecteur de catégorie du formulaire : React Query
  // dédoublonne, ce rail ne déclenche pas de lecture supplémentaire.
  const { data: categories } = useExpenseCategories();
  const categoryName =
    (categories ?? []).find((c) => c.id === categoryId)?.name ?? 'this category';
  const rows = (data ?? []).slice(0, HISTORY_ROWS);

  return (
    <div className="space-y-3" data-testid="expense-history">
      <SectionLabel as="h2" size="sm" className="text-gold">
        Recent in {categoryName}
      </SectionLabel>

      {isLoading && (
        <p className="text-xs text-text-muted">Loading recent expenses…</p>
      )}

      {isError && (
        <p className="text-xs text-text-muted" data-testid="expense-history-error">
          Recent expenses could not be loaded — nothing here is a zero.
        </p>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-xs text-text-muted" data-testid="expense-history-empty">
          No earlier expense in this category — this one is the first.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-data tabular-nums text-text-secondary">
                {r.expense_date}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-muted" title={r.description}>
                {r.description}
              </span>
              <span className="font-data tabular-nums text-text-primary">
                {formatCurrency(r.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
