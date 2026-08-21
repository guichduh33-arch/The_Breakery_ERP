// apps/backoffice/src/features/loyalty/components/CustomerListRow.tsx
//
// One row in the BO loyalty list. Tier computed via shared
// tierFromLifetime; LoyaltyBadge renders the pill.

import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { LoyaltyBadge, Button } from '@breakery/ui';
import { tierFromLifetime } from '@breakery/domain';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { CustomerListRow as Row } from '../hooks/useLoyaltyCustomersList.js';

export interface CustomerListRowProps {
  row:       Row;
  canAdjust: boolean;
  canEdit:   boolean;
  canDelete: boolean;
  onView:    (r: Row) => void;
  onAdjust:  (r: Row) => void;
  onEdit:    (r: Row) => void;
  onDelete:  (r: Row) => void;
}

// Entrée du menu d'actions de ligne. `bg-surface-4` et non `bg-bg-overlay` :
// dans le thème clair `--bg-overlay`, `--bg-elevated` et `--bg-input` valent
// TOUS #ffffff, donc survol et focus repeignaient le panneau blanc de sa propre
// couleur — ratio 1,000:1. Et `focus:outline-none` était posé sans remplaçant :
// au clavier, rien ne désignait l'entrée sélectionnée, Delete compris
// (WCAG 2.4.7). Le fichier importait déjà `FOCUS_RING` et le posait sur la
// cellule du nom ; il l'avait simplement oublié ici.
const MENU_ITEM =
  `block w-full text-left px-3 py-2 text-sm hover:bg-surface-4 focus:bg-surface-4 ${FOCUS_RING}`;

function formatLastVisit(iso: string | null): string {
  if (iso === null) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function CustomerListRow({
  row,
  canAdjust,
  canEdit,
  canDelete,
  onView,
  onAdjust,
  onEdit,
  onDelete,
}: CustomerListRowProps): JSX.Element {
  const tier = tierFromLifetime(row.lifetime_points);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Close on outside-click + Escape, and restore focus to the trigger.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent): void {
      const target = e.target as Node | null;
      if (target === null) return;
      if (menuRef.current?.contains(target)) return;
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

  function handleNameKey(e: KeyboardEvent<HTMLTableCellElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onView(row);
    }
  }

  return (
    <tr className="border-b border-border-subtle hover:bg-surface-4">
      <td
        // `focus-visible:ring-accent-primary` ne résolvait à AUCUNE couleur —
        // `accent-primary` n'existe dans aucune famille du preset — donc la
        // cellule, atteignable au clavier, n'avait aucun indicateur (WCAG 2.4.7).
        className={`px-3 py-2 cursor-pointer ${FOCUS_RING}`}
        role="button"
        tabIndex={0}
        onClick={() => onView(row)}
        onKeyDown={handleNameKey}
        aria-label={`View loyalty history for ${row.name}`}
      >
        {row.name}
      </td>
      <td className="px-3 py-2 text-text-secondary">{row.phone ?? '—'}</td>
      <td className="px-3 py-2">
        <LoyaltyBadge tier={tier} points={row.loyalty_points} />
      </td>
      <td className="px-3 py-2 font-mono">{row.loyalty_points.toLocaleString('id-ID')}</td>
      <td className="px-3 py-2 font-mono text-text-secondary">
        {row.lifetime_points.toLocaleString('id-ID')}
      </td>
      <td className="px-3 py-2 text-text-secondary">{formatLastVisit(row.last_visit_at)}</td>
      <td className="px-3 py-2 relative text-right">
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
            className="absolute right-0 mt-1 w-44 bg-bg-elevated border border-border-subtle rounded-md shadow-lg z-10"
          >
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM}
              onClick={() => { setMenuOpen(false); onView(row); }}
            >
              View history
            </button>
            {canAdjust && (
              <button
                type="button"
                role="menuitem"
                className={MENU_ITEM}
                onClick={() => { setMenuOpen(false); onAdjust(row); }}
              >
                Adjust points
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                role="menuitem"
                className={MENU_ITEM}
                onClick={() => { setMenuOpen(false); onEdit(row); }}
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                role="menuitem"
                className={`${MENU_ITEM} text-red`}
                onClick={() => { setMenuOpen(false); onDelete(row); }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
