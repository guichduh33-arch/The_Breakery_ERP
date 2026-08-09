// apps/backoffice/src/hooks/useListboxKeyboard.ts
//
// Clavier du motif ARIA `combobox` + `listbox`, en descendant actif.
//
// POURQUOI CE HOOK EXISTE. Les quatre auto-complétions du module inventaire
// câblaient la sélection sur `onMouseDown` seul, avec `preventDefault()` pour
// garder le focus dans le champ. Or `Entrée` et `Espace` sur un élément émettent
// un `click`, jamais un `mousedown` : la sélection ne partait pas. S'y ajoutait
// la fermeture différée au `blur` du champ (120-150 ms), qui escamotait la liste
// avant que `Tab` ne l'atteigne. Résultat mesuré le 2026-08-09 : enregistrer une
// production, saisir un achat direct, filtrer le grand livre et recevoir ou
// déclarer une perte étaient infaisables au clavier — WCAG 2.1.1, niveau A.
//
// LE CHOIX. On garde le focus DANS le champ et on déplace une surbrillance
// virtuelle via `aria-activedescendant`. C'est le motif combobox de référence,
// et c'est le seul qui rende la fermeture différée inoffensive : le focus ne
// quitte jamais le champ, donc le `blur` ne se déclenche pas pendant la
// navigation. Corollaire : les options ne sont PAS focalisables — ce sont des
// `role="option"` non tabulables, pas des `<button>`. Un bouton dans une liste
// pilotée au descendant actif ferait tabuler l'utilisateur à travers chaque
// option, ce que le motif existe précisément pour éviter.
//
// La souris n'est pas touchée : les appelants gardent leur `onMouseDown`.

import { useCallback, useEffect, useId, useState, type KeyboardEvent } from 'react';

export interface ListboxKeyboard {
  /** Index surligné, ou -1 si aucun. À refléter par `aria-selected` sur l'option. */
  activeIndex:         number;
  /** À poser sur le conteneur `role="listbox"` et sur `aria-controls` du champ. */
  listboxId:           string;
  /** Valeur d'`aria-activedescendant` du champ ; `undefined` quand rien n'est surligné. */
  activeDescendantId:  string | undefined;
  /** `id` d'une option, à poser sur chaque `role="option"`. */
  optionId:            (index: number) => string;
  /** Aligne la surbrillance sur le survol souris, pour que les deux modes concordent. */
  onOptionHover:       (index: number) => void;
  /** À poser sur le `onKeyDown` du CHAMP, pas de la liste. */
  handleKeyDown:       (event: KeyboardEvent<HTMLElement>) => void;
}

export function useListboxKeyboard<T>(params: {
  items:    readonly T[];
  open:     boolean;
  onSelect: (item: T) => void;
  onClose:  () => void;
}): ListboxKeyboard {
  const { items, open, onSelect, onClose } = params;
  const baseId = useId();
  const [rawIndex, setRawIndex] = useState<number>(-1);

  // Clamp au rendu plutôt qu'en effet : une liste qui rétrécit sous l'index
  // courant (la frappe suivante filtre plus dur) laisserait sinon
  // `aria-activedescendant` pointer un id absent du DOM, ce que les lecteurs
  // d'écran signalent comme une référence morte.
  const activeIndex = open && rawIndex >= 0 && rawIndex < items.length ? rawIndex : -1;

  useEffect(() => {
    if (!open) setRawIndex(-1);
  }, [open]);

  const optionId = useCallback(
    (index: number): string => `${baseId}-option-${String(index)}`,
    [baseId],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.key === 'Escape') {
        // Échap ferme même une liste vide ou déjà repliée — c'est la sortie de
        // secours, elle ne doit jamais dépendre de l'état de la liste.
        event.preventDefault();
        setRawIndex(-1);
        onClose();
        return;
      }
      if (!open || items.length === 0) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setRawIndex((i) => (i + 1) % items.length);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setRawIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
          break;
        case 'Home':
          event.preventDefault();
          setRawIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setRawIndex(items.length - 1);
          break;
        case 'Enter': {
          const item = activeIndex >= 0 ? items[activeIndex] : undefined;
          // Aucune option surlignée : on laisse `Entrée` au formulaire. Le
          // capter ici empêcherait de soumettre une modale au clavier.
          if (item === undefined) return;
          event.preventDefault();
          setRawIndex(-1);
          onSelect(item);
          break;
        }
        default:
          break;
      }
    },
    [open, items, activeIndex, onSelect, onClose],
  );

  return {
    activeIndex,
    listboxId: `${baseId}-listbox`,
    activeDescendantId: activeIndex >= 0 ? optionId(activeIndex) : undefined,
    optionId,
    onOptionHover: setRawIndex,
    handleKeyDown,
  };
}
