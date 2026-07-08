// apps/backoffice/src/features/inventory/components/StockLevelRow.tsx
//
// One row in the inventory list. Click anywhere on the SKU/name to open
// the product stock detail page. Action menu offers Adjust / Receive /
// Waste — each gated by the matching permission.

import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@breakery/ui';
import { LowStockBadge } from './LowStockBadge.js';
import type { StockLevelRow as Row } from '../hooks/useStockLevels.js';

export interface StockLevelRowProps {
  row:        Row;
  canAdjust:  boolean;
  canReceive: boolean;
  canWaste:   boolean;
  onView:     (r: Row) => void;
  onAdjust:   (r: Row) => void;
  onReceive:  (r: Row) => void;
  onWaste:    (r: Row) => void;
}

function formatLastMovement(iso: string | null): string {
  if (iso === null) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function StockLevelRow({
  row, canAdjust, canReceive, canWaste, onView, onAdjust, onReceive, onWaste,
}: StockLevelRowProps): JSX.Element {
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

  function handleNameKey(e: KeyboardEvent<HTMLTableCellElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onView(row);
    }
  }

  const hasAnyAction = canAdjust || canReceive || canWaste;
  // track_inventory absent (fixtures/anciens appels) = considéré suivi ; seul false = non suivi.
  const tracked = row.track_inventory !== false;

  return (
    <tr className="border-b border-border-subtle hover:bg-bg-overlay">
      <td className="px-3 py-2 font-mono text-xs text-text-secondary">{row.sku}</td>
      <td
        className="px-3 py-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        role="button"
        tabIndex={0}
        onClick={() => onView(row)}
        onKeyDown={handleNameKey}
        aria-label={`View stock detail for ${row.name}`}
      >
        <div className="flex items-center">
          <span>{row.name}</span>
          {tracked && (
            <LowStockBadge currentStock={row.current_stock} minStockThreshold={row.min_stock_threshold} />
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-text-secondary">{row.category_name ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-right">
        {tracked
          ? row.current_stock.toLocaleString()
          : <span className="text-text-muted">Non suivi</span>}
      </td>
      <td className="px-3 py-2 text-text-secondary">{formatLastMovement(row.last_movement_at)}</td>
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
              className="block w-full text-left px-3 py-2 text-sm hover:bg-bg-overlay focus:bg-bg-overlay focus:outline-none"
              onClick={() => { setMenuOpen(false); onView(row); }}
            >
              View stock
            </button>
            {canAdjust && (
              <button
                type="button"
                role="menuitem"
                className="block w-full text-left px-3 py-2 text-sm hover:bg-bg-overlay focus:bg-bg-overlay focus:outline-none"
                onClick={() => { setMenuOpen(false); onAdjust(row); }}
              >
                Adjust stock
              </button>
            )}
            {canReceive && (
              <button
                type="button"
                role="menuitem"
                className="block w-full text-left px-3 py-2 text-sm hover:bg-bg-overlay focus:bg-bg-overlay focus:outline-none"
                onClick={() => { setMenuOpen(false); onReceive(row); }}
              >
                Receive stock
              </button>
            )}
            {canWaste && (
              <button
                type="button"
                role="menuitem"
                className="block w-full text-left px-3 py-2 text-sm text-red hover:bg-bg-overlay focus:bg-bg-overlay focus:outline-none"
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
      </td>
    </tr>
  );
}
