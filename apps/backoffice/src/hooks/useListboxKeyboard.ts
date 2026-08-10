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
// LA SURBRILLANCE EST ANCRÉE SUR L'IDENTITÉ, PAS SUR L'INDICE. Retenir un indice
// serait un piège d'argent : ces listes se rafraîchissent sous l'utilisateur
// (react-query, refetch au retour de fenêtre). Une liste réordonnée entre le
// moment où l'on surligne et celui où l'on valide ferait enregistrer un
// mouvement de stock sur un AUTRE produit que celui regardé, sans rien changer à
// l'écran. Ancrée sur la clé, la surbrillance suit son produit, et disparaît
// proprement si le produit sort des résultats.
//
// La souris n'est pas touchée : les appelants gardent leur `onMouseDown`.

import {
  useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent,
} from 'react';

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
  /**
   * Décompte des résultats, à rendre dans une région `sr-only` + `role="status"`.
   * Une liste pilotée au descendant actif ne déplace pas le focus : sans cette
   * annonce, un lecteur d'écran ne sait jamais que des résultats sont apparus.
   * Anglais littéral — l'interface l'est par décision produit, et aucune couche
   * i18n n'est prévue (PRODUCT.md).
   */
  statusText:          string;
}

/**
 * État visuel d'une option de listbox — survol et surbrillance active. Partagé
 * par les quatre auto-complétions : la copie divergente de ce genre de classe
 * est exactement la dérive que l'audit du 2026-08-09 a relevée. Chaque appelant
 * garde sa mise en page (gouttières, alignement), seul l'état est commun.
 *
 * `bg-surface-4` et non `bg-bg-overlay` : dans le thème clair les deux tokens de
 * surface valent #ffffff, la surbrillance ne rendait donc rien. Et en mode
 * contraste forcé (Windows), tout fond d'auteur est écrasé par le système —
 * d'où le contour, qui lui survit et reste le seul repère.
 */
export function listboxOptionState(active: boolean): string {
  return active
    ? 'cursor-pointer bg-surface-4 hover:bg-surface-4 forced-colors:outline forced-colors:outline-2'
    : 'cursor-pointer hover:bg-surface-4';
}

export function useListboxKeyboard<T>(params: {
  items:      readonly T[];
  open:       boolean;
  /** Identité stable de l'élément (son `id`), pas son rang. */
  getItemKey: (item: T) => string;
  onSelect:   (item: T) => void;
  onClose:    () => void;
}): ListboxKeyboard {
  const { items, open, getItemKey, onSelect, onClose } = params;
  const baseId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Résolu au rendu : si le produit surligné a quitté les résultats (la frappe
  // suivante filtre plus dur, un refetch le retire), `findIndex` rend -1 et
  // `aria-activedescendant` se retire de lui-même. Aucun id mort exposé.
  const activeIndex = useMemo<number>(() => {
    if (!open || activeKey === null) return -1;
    return items.findIndex((item) => getItemKey(item) === activeKey);
  }, [open, activeKey, items, getItemKey]);

  useEffect(() => {
    if (!open) setActiveKey(null);
  }, [open]);

  const optionId = useCallback(
    (index: number): string => `${baseId}-option-${String(index)}`,
    [baseId],
  );

  const activeDescendantId = activeIndex >= 0 ? optionId(activeIndex) : undefined;

  // La surbrillance virtuelle ne défile pas toute seule : contrairement au focus
  // réel, `aria-activedescendant` ne fait rien remonter dans un conteneur
  // `overflow-auto`. Sans ceci, la 7ᵉ option d'une liste plafonnée à 15rem est
  // surlignée hors du champ de vision — la flèche bas semble ne plus rien faire.
  useEffect(() => {
    if (activeDescendantId === undefined || typeof document === 'undefined') return;
    const el = document.getElementById(activeDescendantId);
    // jsdom n'implémente pas scrollIntoView : on ne suppose pas sa présence.
    if (el !== null && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeDescendantId]);

  const highlightAt = useCallback(
    (index: number): void => {
      const item = items[index];
      if (item !== undefined) setActiveKey(getItemKey(item));
    },
    [items, getItemKey],
  );

  const move = useCallback(
    (delta: number): void => {
      if (items.length === 0) return;
      // Rien de surligné : ↓ prend la première, ↑ prend la dernière.
      const next = activeIndex < 0
        ? (delta > 0 ? 0 : items.length - 1)
        : (activeIndex + delta + items.length) % items.length;
      highlightAt(next);
    },
    [items, activeIndex, highlightAt],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.key === 'Escape') {
        // Échap ferme même une liste vide ou déjà repliée — c'est la sortie de
        // secours, elle ne doit jamais dépendre de l'état de la liste.
        event.preventDefault();
        setActiveKey(null);
        onClose();
        return;
      }
      if (!open || items.length === 0) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          move(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          move(-1);
          break;
        case 'Home':
          event.preventDefault();
          highlightAt(0);
          break;
        case 'End':
          event.preventDefault();
          highlightAt(items.length - 1);
          break;
        case 'Enter': {
          const item = activeIndex >= 0 ? items[activeIndex] : undefined;
          // Aucune option surlignée : on laisse `Entrée` au formulaire. Le
          // capter ici empêcherait de soumettre une modale au clavier.
          if (item === undefined) return;
          event.preventDefault();
          setActiveKey(null);
          onSelect(item);
          break;
        }
        default:
          break;
      }
    },
    [open, items, activeIndex, move, highlightAt, onSelect, onClose],
  );

  const statusText = !open
    ? ''
    : items.length === 0
      ? 'No results.'
      : `${String(items.length)} result${items.length > 1 ? 's' : ''} available.`;

  return {
    activeIndex,
    listboxId: `${baseId}-listbox`,
    activeDescendantId,
    optionId,
    onOptionHover: highlightAt,
    handleKeyDown,
    statusText,
  };
}
