// apps/backoffice/src/features/inventory/components/StockRowActions.tsx
//
// Menu d'actions d'une ligne de la liste de stock. Extrait de l'ancien
// `StockLevelRow`, qui rendait un `<tr>` entier à la main — la liste passe
// désormais par le `DataTable` partagé (ADR-024, archétype List), qui apporte
// `scope="col"`, `aria-sort`, le squelette de chargement et l'état vide.
//
// Le comportement du menu est repris tel quel : Échap referme et rend le focus
// au déclencheur, un clic extérieur referme. La navigation aux flèches promise
// par `role="menu"` n'est toujours pas tenue — c'est un défaut connu, traité
// hors de ce lot.

import { useEffect, useRef, useState, type JSX } from 'react';
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

export function StockRowActions({
  row, canAdjust, canWaste, onView, onAdjust, onWaste,
}: StockRowActionsProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef    = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent): void {
      const target = e.target as Node | null;
      if (target === null) return;
      if (menuRef.current?.contains(target))    return;
      if (triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const hasAnyAction = canAdjust || canWaste;

  return (
    <div className="relative inline-block text-right">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={() => setMenuOpen((o) => !o)}
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
          className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-border-subtle bg-bg-elevated shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            onClick={() => { setMenuOpen(false); onView(row); }}
          >
            View stock
          </button>
          {canAdjust && (
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM}
              onClick={() => { setMenuOpen(false); onAdjust(row); }}
            >
              Adjust stock
            </button>
          )}
          {canWaste && (
            <button
              type="button"
              role="menuitem"
              // `red-as-text` et non `red` : `--red-base` est la teinte de
              // REMPLISSAGE, `--red-as-text` celle du premier plan. Elles sont
              // égales en thème clair et divergent en sombre.
              className={`${MENU_ITEM} text-red-as-text`}
              onClick={() => { setMenuOpen(false); onWaste(row); }}
            >
              Record waste
            </button>
          )}
          {!hasAnyAction && (
            <div className="px-3 py-2 text-xs text-text-muted">No actions available.</div>
          )}
        </div>
      )}
    </div>
  );
}
