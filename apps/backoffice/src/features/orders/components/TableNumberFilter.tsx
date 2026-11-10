// apps/backoffice/src/features/orders/components/TableNumberFilter.tsx
//
// S3-21 — filtre par table de la liste des commandes. Champ texte et non
// liste : la RPC filtre par égalité stricte sur le numéro saisi, et une table
// renommée garde son historique sous l'ancien nom.
//
// Même discipline que les dates de la page : la frappe reste locale et se
// COMMET en débounce (ou au blur / Entrée) — sinon chaque caractère
// émettrait un couple de RPC liste + compteurs.

import { type JSX, useEffect, useRef, useState } from 'react';
import { Input } from '@breakery/ui';

const COMMIT_MS = 400;

export interface TableNumberFilterProps {
  /** Valeur commise (URL) ; '' = aucune table. */
  value:    string;
  /** Reçoit la valeur nettoyée ; '' efface le filtre. */
  onCommit: (next: string) => void;
}

export function TableNumberFilter({ value, onCommit }: TableNumberFilterProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const commit = (raw: string, immediate = false): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    const write = (): void => {
      const next = raw.trim();
      if (next !== value) onCommit(next);
    };
    if (immediate) write();
    else timer.current = setTimeout(write, COMMIT_MS);
  };

  return (
    <>
      <label htmlFor="orders-table-number" className="sr-only">Table</label>
      <Input
        id="orders-table-number"
        type="search"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
        onBlur={() => { commit(draft, true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(draft, true); }}
        placeholder="Table"
        maxLength={32}
        className="h-9 w-28"
        data-testid="orders-table-filter"
      />
    </>
  );
}
