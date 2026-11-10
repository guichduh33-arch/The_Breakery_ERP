// apps/backoffice/src/components/DebouncedInput.tsx
//
// S3-22 — champ texte dont la valeur se COMMET en différé (pause de frappe,
// blur ou Entrée), généralisé depuis le filtre de table de la liste des
// commandes. La frappe reste locale : sans ce différé, chaque caractère
// réécrirait l'URL et relancerait les RPC qui en dépendent.
//
// La valeur commise est nettoyée (`trim`) ; '' signifie « pas de filtre ».
// Un changement EXTERNE de `value` (bouton « Clear filters ») annule le commit
// en attente : sinon l'ancienne saisie reviendrait 400 ms après l'effacement.

import { type JSX, useEffect, useRef, useState } from 'react';
import { Input, type InputProps } from '@breakery/ui';

export const DEBOUNCED_COMMIT_MS = 400;

export interface DebouncedInputProps
  extends Omit<InputProps, 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown'> {
  /** Valeur commise (souvent l'URL) ; '' = vide. */
  value:    string;
  /** Reçoit la valeur nettoyée, seulement si elle diffère de `value`. */
  onCommit: (next: string) => void;
}

export function DebouncedInput({ value, onCommit, ...rest }: DebouncedInputProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dernière valeur émise par CE champ : son écho dans `value` n'est pas un
  // changement externe, et ne doit ni écraser la frappe en cours ni l'annuler.
  const lastCommitted = useRef(value);

  useEffect(() => {
    if (value === lastCommitted.current) return;
    lastCommitted.current = value;
    if (timer.current !== null) clearTimeout(timer.current);
    setDraft(value);
  }, [value]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const commit = (raw: string, immediate = false): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    const write = (): void => {
      const next = raw.trim();
      if (next === value) return;
      lastCommitted.current = next;
      onCommit(next);
    };
    if (immediate) write();
    else timer.current = setTimeout(write, DEBOUNCED_COMMIT_MS);
  };

  return (
    <Input
      type="search"
      {...rest}
      value={draft}
      onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
      onBlur={() => { commit(draft, true); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(draft, true); }}
    />
  );
}
