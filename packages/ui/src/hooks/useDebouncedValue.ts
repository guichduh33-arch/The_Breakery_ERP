// packages/ui/src/hooks/useDebouncedValue.ts
//
// Audit UX/UI 2026-08-13 (lot 4) — premier hook de debounce PARTAGÉ du repo.
// Extrait tel quel d'IngredientPicker (il y vivait en privé) : quatre idiomes
// de minuterie coexistaient dans le back-office, celui-ci est le seul déjà
// emballé en hook. La valeur rendue suit `value` avec `delay` ms de retard ;
// chaque changement replanifie la minuterie, donc pas de closure obsolète.

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => { setDebounced(value); }, delay);
    return () => { clearTimeout(id); };
  }, [value, delay]);
  return debounced;
}
