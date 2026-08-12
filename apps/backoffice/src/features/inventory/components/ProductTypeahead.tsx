// apps/backoffice/src/features/inventory/components/ProductTypeahead.tsx
//
// Minimal product typeahead used by the Receive/Waste modals. Renders an
// input + a results list that only appears once the user has typed at
// least 2 characters and the query has resolved. Selecting a row collapses
// the list and forwards the chosen product to the caller.

import { useEffect, useRef, useState, type JSX } from 'react';
import { Input } from '@breakery/ui';
import { formatQuantity } from '@breakery/utils';
import { listboxOptionState, useListboxKeyboard } from '@/hooks/useListboxKeyboard.js';
import {
  useProductsForInventory,
  type ProductTypeaheadRow,
} from '../hooks/useProductsForInventory.js';

export interface ProductTypeaheadProps {
  value:       ProductTypeaheadRow | null;
  onChange:    (p: ProductTypeaheadRow | null) => void;
  disabled?:   boolean;
  placeholder?: string;
  id?:         string;
}

export function ProductTypeahead({
  value, onChange, disabled, placeholder, id,
}: ProductTypeaheadProps): JSX.Element {
  const [search, setSearch] = useState<string>(value !== null ? value.name : '');
  const [open,   setOpen  ] = useState<boolean>(false);
  const q = useProductsForInventory(search);

  function handleSelect(p: ProductTypeaheadRow): void {
    onChange(p);
    setSearch(p.name);
    setOpen(false);
  }

  const rows       = q.data ?? [];
  const listOpen   = open && search.trim().length >= 2;
  const keyboard   = useListboxKeyboard<ProductTypeaheadRow>({
    items:      rows,
    open:       listOpen,
    getItemKey: (p) => p.id,
    onSelect:   handleSelect,
    onClose:    () => { setOpen(false); },
  });

  // La fermeture différée survivait au démontage : fermer la modale pendant les
  // 120 ms laissait une minuterie appeler `setOpen` sur un composant disparu.
  const blurTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
  }, []);

  function handleClear(): void {
    onChange(null);
    setSearch('');
    setOpen(true);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        value={search}
        autoComplete="off"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={keyboard.listboxId}
        aria-autocomplete="list"
        aria-activedescendant={keyboard.activeDescendantId}
        placeholder={placeholder ?? 'Search by name (min 2 chars)…'}
        disabled={disabled === true}
        onFocus={() => setOpen(true)}
        onKeyDown={keyboard.handleKeyDown}
        onChange={(e) => {
          setSearch(e.target.value);
          if (value !== null && e.target.value !== value.name) onChange(null);
          setOpen(true);
        }}
        onBlur={() => {
          // Allow click to register on a list item before closing. Inoffensif
          // au clavier : le focus ne quitte jamais le champ (descendant actif).
          blurTimer.current = window.setTimeout(() => { setOpen(false); }, 120);
        }}
      />
      {/* Le descendant actif ne déplace pas le focus : sans cette annonce, un
          lecteur d'écran n'apprend jamais que des résultats sont apparus. */}
      <span className="sr-only" role="status" aria-live="polite">{keyboard.statusText}</span>
      {value !== null && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear selected product"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary text-xs"
        >
          Clear
        </button>
      )}
      {listOpen && (
        <div
          role="listbox"
          id={keyboard.listboxId}
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border-subtle bg-bg-elevated shadow-lg"
        >
          {/* `role="presentation"` : un `listbox` n'admet que des `option` pour
              enfants. Sans ça, un message d'état est annoncé comme un résultat
              sélectionnable — et « Searching… » devient un produit. */}
          {q.isLoading && (
            <div role="presentation" className="px-3 py-2 text-xs text-text-secondary">Searching…</div>
          )}
          {q.error && (
            <div role="presentation" className="px-3 py-2 text-xs text-red">Search failed: {q.error.message}</div>
          )}
          {q.data?.length === 0 && (
            <div role="presentation" className="px-3 py-2 text-xs text-text-secondary">No products match.</div>
          )}
          {rows.map((p, i) => (
            // Non focalisable, et c'est le motif : la surbrillance est portée
            // par `aria-activedescendant` depuis le champ. `bg-surface-4` et non
            // `bg-bg-overlay`, qui vaut #ffffff dans le thème clair et ne
            // produisait donc aucun retour visible.
            <div
              key={p.id}
              role="option"
              id={keyboard.optionId(i)}
              aria-selected={keyboard.activeIndex === i}
              onMouseEnter={() => { keyboard.onOptionHover(i); }}
              onMouseDown={(e) => {
                // Prevent the input blur from closing the list before click fires.
                e.preventDefault();
                handleSelect(p);
              }}
              className={`block w-full px-3 py-2 text-left text-sm ${listboxOptionState(keyboard.activeIndex === i)}`}
            >
              {/* `min-w-0` + `truncate` : un nom de produit long poussait sinon
                  le SKU et le stock hors de la liste. `shrink-0` garde la
                  colonne de droite entière — c'est elle qui désambiguïse deux
                  produits au nom proche. */}
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{p.name}</span>
                {/* La requête du typeahead ne sélectionne pas `unit` : stock
                    sans suffixe, séparateurs de milliers id-ID compris. */}
                <span className="shrink-0 font-mono tabular-nums text-xs text-text-secondary">
                  {p.sku} · {formatQuantity(p.current_stock, null)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
