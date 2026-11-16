// apps/backoffice/src/features/orders/components/TableNumberFilter.tsx
//
// S3-21 — filtre par table de la liste des commandes. Champ texte et non
// liste : la RPC filtre par égalité stricte sur le numéro saisi, et une table
// renommée garde son historique sous l'ancien nom.
//
// Même discipline que les dates de la page : la frappe reste locale et se
// COMMET en débounce (ou au blur / Entrée) — sinon chaque caractère
// émettrait un couple de RPC liste + compteurs. S3-22 : ce comportement vit
// désormais dans `DebouncedInput`, partagé avec la barre de filtres des rapports.

import type { JSX } from 'react';
import { DebouncedInput } from '@/components/DebouncedInput.js';

export interface TableNumberFilterProps {
  /** Valeur commise (URL) ; '' = aucune table. */
  value:    string;
  /** Reçoit la valeur nettoyée ; '' efface le filtre. */
  onCommit: (next: string) => void;
}

export function TableNumberFilter({ value, onCommit }: TableNumberFilterProps): JSX.Element {
  return (
    <>
      <label htmlFor="orders-table-number" className="sr-only">Table</label>
      <DebouncedInput
        id="orders-table-number"
        value={value}
        onCommit={onCommit}
        placeholder="Table"
        maxLength={32}
        className="h-9 w-28"
        data-testid="orders-table-filter"
      />
    </>
  );
}
