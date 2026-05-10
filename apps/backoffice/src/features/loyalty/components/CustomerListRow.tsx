// apps/backoffice/src/features/loyalty/components/CustomerListRow.tsx
//
// One row in the BO loyalty list. Tier computed via shared
// tierFromLifetime; LoyaltyBadge renders the pill.

import { useState, type JSX } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { LoyaltyBadge, Button } from '@breakery/ui';
import { tierFromLifetime } from '@breakery/domain';
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

  return (
    <tr className="border-b border-border-subtle hover:bg-bg-overlay">
      <td className="px-3 py-2 cursor-pointer" onClick={() => onView(row)}>
        {row.name}
      </td>
      <td className="px-3 py-2 text-text-secondary">{row.phone ?? '—'}</td>
      <td className="px-3 py-2">
        <LoyaltyBadge tier={tier} points={row.loyalty_points} />
      </td>
      <td className="px-3 py-2 font-mono">{row.loyalty_points.toLocaleString()}</td>
      <td className="px-3 py-2 font-mono text-text-secondary">
        {row.lifetime_points.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-text-secondary">{formatLastVisit(row.last_visit_at)}</td>
      <td className="px-3 py-2 relative text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Row actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
        {menuOpen && (
          <div className="absolute right-0 mt-1 w-44 bg-bg-elevated border border-border-subtle rounded-md shadow-lg z-10">
            <button
              className="block w-full text-left px-3 py-2 text-sm hover:bg-bg-overlay"
              onClick={() => { setMenuOpen(false); onView(row); }}
            >
              View history
            </button>
            {canAdjust && (
              <button
                className="block w-full text-left px-3 py-2 text-sm hover:bg-bg-overlay"
                onClick={() => { setMenuOpen(false); onAdjust(row); }}
              >
                Adjust points
              </button>
            )}
            {canEdit && (
              <button
                className="block w-full text-left px-3 py-2 text-sm hover:bg-bg-overlay"
                onClick={() => { setMenuOpen(false); onEdit(row); }}
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                className="block w-full text-left px-3 py-2 text-sm text-red hover:bg-bg-overlay"
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
