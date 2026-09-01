// apps/backoffice/src/components/RowActionsMenu.tsx
//
// LA grammaire d'actions de ligne du back-office (critique du 2026-08-31, P1).
//
// Il y en avait trois : deux icônes nues sur Orders (dont `Void` en PREMIÈRE
// position), trois icônes nues sur Products (dont la suppression en TROISIÈME),
// et un menu `…` sur l'inventaire. Le coût n'est pas cosmétique : au repos,
// l'icône destructrice et l'icône bénigne rendaient dans le MÊME
// `text-text-subtle`, et le seul différenciateur — `hover:bg-red-soft` — n'est
// visible qu'une fois le pointeur déjà dessus. Qui apprend « la dernière icône
// est sans risque » sur Orders se trompe sur Products.
//
// On converge sur le menu : il NOMME les actions en mots, et il supprime
// l'adjacence entre une cible destructrice et une cible bénigne.
//
// Le motif clavier est celui du menu bouton (WAI-ARIA APG), repris tel quel de
// `StockRowActions` — qui l'avait implémenté correctement et reste désormais
// un simple appelant :
//   · ouverture au clic ou à Flèche bas / Flèche haut sur le déclencheur ;
//   · le focus entre sur le premier élément (ou le dernier si Flèche haut) ;
//   · Flèche bas / haut circulent, Origine / Fin vont aux extrémités ;
//   · Échap et Tab referment et rendent le focus au déclencheur.
// `useListboxKeyboard` ne convient pas : il implémente `aria-activedescendant`,
// où le focus RESTE sur le champ. Un menu fait l'inverse.

import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@breakery/ui';

// Anneau de focus du back-office.
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

// `bg-surface-4` et non `bg-bg-overlay` : dans le thème clair les deux tokens de
// surface valent #ffffff, donc survol ET focus étaient blanc sur blanc — ratio
// 1,00, aucun retour visible sur des entrées atteignables au clavier.
const MENU_ITEM =
  `block w-full text-left px-3 py-2 text-sm hover:bg-surface-4 focus:bg-surface-4 ${FOCUS_RING}`;

export interface RowActionEntry {
  /** Clé de rendu React, stable pour la ligne. */
  key:      string;
  /** Libellé EN MOTS — c'est tout l'intérêt du menu sur l'icône nue. */
  label:    string;
  /** Rend l'entrée en rouge de texte. Une action destructrice se nomme au repos. */
  danger?:  boolean;
  testId?:  string;
  activate: () => void;
}

export interface RowActionsMenuProps {
  /** Sujet de la ligne, pour le libellé accessible : « Actions for <subject> ». */
  subject: string;
  entries: RowActionEntry[];
  testId?: string;
}

export function RowActionsMenu({ subject, entries, testId }: RowActionsMenuProps): JSX.Element | null {
  const [menuOpen, setMenuOpen] = useState(false);
  /** Index à focaliser à la prochaine ouverture — dernier si ouverture par Flèche haut. */
  const [pendingFocus, setPendingFocus] = useState<'first' | 'last'>('first');
  const menuRef    = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs   = useRef<(HTMLButtonElement | null)[]>([]);

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
  // `role="menu"` promet et que peu d'implémentations tiennent.
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

  // Une ligne dont toutes les actions sont filtrées par les permissions ne rend
  // pas un déclencheur qui ouvre le vide.
  if (entries.length === 0) return null;

  return (
    <div className="relative inline-block text-right">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        // La ligne porte souvent son propre `onClick` (ouvrir le détail) :
        // sans arrêt de propagation, ouvrir le menu navigue en même temps.
        onClick={(e) => { e.stopPropagation(); setPendingFocus('first'); setMenuOpen((o) => !o); }}
        onKeyDown={onTriggerKeyDown}
        aria-label={`Actions for ${subject}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        {...(testId === undefined ? {} : { 'data-testid': testId })}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${subject}`}
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
              {...(entry.testId === undefined ? {} : { 'data-testid': entry.testId })}
              onClick={(e) => { e.stopPropagation(); close(true); entry.activate(); }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
