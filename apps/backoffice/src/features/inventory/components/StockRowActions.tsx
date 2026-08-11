// apps/backoffice/src/features/inventory/components/StockRowActions.tsx
//
// Menu d'actions d'une ligne de la liste de stock.
//
// Ce composant annonce `role="menu"` / `role="menuitem"`. Ce contrat n'était
// pas tenu : le focus ne rentrait pas dans le menu à l'ouverture et les
// flèches ne faisaient rien — il fallait Tab, Tab, Tab. Un contrat ARIA
// annoncé et non tenu est pire qu'un simple groupe de boutons, parce qu'il
// promet une navigation qui n'existe pas.
//
// Le motif implémenté est celui d'un menu bouton (WAI-ARIA APG) :
//   · ouverture au clic ou à Flèche bas / Flèche haut sur le déclencheur ;
//   · le focus entre sur le premier élément (ou le dernier si l'on ouvre par
//     Flèche haut) ;
//   · Flèche bas / haut circulent, Origine / Fin vont aux extrémités ;
//   · Échap et Tab referment et rendent le focus au déclencheur.
// `useListboxKeyboard` ne convient pas ici : il implémente le motif
// `aria-activedescendant`, où le focus RESTE sur le champ. Un menu fait
// l'inverse.

import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { StockLevelRow as Row } from '../hooks/useStockLevels.js';

// Anneau de focus du back-office. Remplace `focus-visible:ring-accent-primary`,
// qui ne résolvait à AUCUNE couleur — `accent-primary` n'existe dans aucune
// famille du preset — et laissait donc la cible sans indicateur (WCAG 2.4.7).
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

// `bg-surface-4` et non `bg-bg-overlay` : dans le thème clair les deux tokens de
// surface valent #ffffff, donc survol ET focus étaient blanc sur blanc — ratio
// 1,00, aucun retour visible sur des entrées atteignables au clavier.
const MENU_ITEM =
  `block w-full text-left px-3 py-2 text-sm hover:bg-surface-4 focus:bg-surface-4 ${FOCUS_RING}`;

export interface StockRowActionsProps {
  row:        Row;
  canAdjust:  boolean;
  canWaste:   boolean;
  onView:     (r: Row) => void;
  onAdjust:   (r: Row) => void;
  onWaste:    (r: Row) => void;
}

interface MenuEntry {
  key:       string;
  label:     string;
  danger?:   boolean;
  activate:  () => void;
}

export function StockRowActions({
  row, canAdjust, canWaste, onView, onAdjust, onWaste,
}: StockRowActionsProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  /** Index à focaliser à la prochaine ouverture — dernier si ouverture par Flèche haut. */
  const [pendingFocus, setPendingFocus] = useState<'first' | 'last'>('first');
  const menuRef    = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs   = useRef<(HTMLButtonElement | null)[]>([]);

  const entries: MenuEntry[] = [
    { key: 'view', label: 'View stock', activate: () => onView(row) },
    ...(canAdjust ? [{ key: 'adjust', label: 'Adjust stock', activate: () => onAdjust(row) }] : []),
    ...(canWaste  ? [{ key: 'waste',  label: 'Record waste', danger: true, activate: () => onWaste(row) }] : []),
  ];

  const close = useCallback((returnFocus: boolean): void => {
    setMenuOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent): void {
      const target = e.target as Node | null;
      if (target === null) return;
      if (menuRef.current?.contains(target))    return;
      if (triggerRef.current?.contains(target)) return;
      // Clic extérieur : on referme sans voler le focus à ce que l'utilisateur
      // vient de viser.
      setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); };
  }, [menuOpen]);

  // Le focus entre dans le menu à l'ouverture — c'est la moitié du contrat que
  // `role="menu"` promettait sans la tenir.
  useEffect(() => {
    if (!menuOpen) return;
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    if (items.length === 0) return;
    (pendingFocus === 'last' ? items[items.length - 1] : items[0])?.focus();
  }, [menuOpen, pendingFocus]);

  function focusAt(index: number): void {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    if (items.length === 0) return;
    const wrapped = ((index % items.length) + items.length) % items.length;
    items[wrapped]?.focus();
  }

  function currentIndex(): number {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    return items.findIndex((el) => el === document.activeElement);
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(currentIndex() + 1); break;
      case 'ArrowUp':   e.preventDefault(); focusAt(currentIndex() - 1); break;
      case 'Home':      e.preventDefault(); focusAt(0); break;
      case 'End':       e.preventDefault(); focusAt(entries.length - 1); break;
      case 'Escape':    e.preventDefault(); e.stopPropagation(); close(true); break;
      // Tab quitte le menu : on referme plutôt que de laisser l'utilisateur
      // tabuler à l'aveugle dans une surface flottante.
      case 'Tab':       close(true); break;
      default: break;
    }
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setPendingFocus(e.key === 'ArrowUp' ? 'last' : 'first');
      setMenuOpen(true);
    }
  }

  return (
    <div className="relative inline-block text-right">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={() => { setPendingFocus('first'); setMenuOpen((o) => !o); }}
        onKeyDown={onTriggerKeyDown}
        aria-label={`Actions for ${row.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${row.name}`}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-border-subtle bg-bg-elevated shadow-lg"
        >
          {entries.map((entry, i) => (
            <button
              key={entry.key}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              // Focus roulant : un seul point d'entrée au clavier, le reste se
              // parcourt aux flèches.
              tabIndex={-1}
              // `red-as-text` et non `red` : `--red-base` est la teinte de
              // REMPLISSAGE, `--red-as-text` celle du premier plan. Égales en
              // thème clair, elles divergent en sombre.
              className={entry.danger === true ? `${MENU_ITEM} text-red-as-text` : MENU_ITEM}
              onClick={() => { close(true); entry.activate(); }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
