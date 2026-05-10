// apps/backoffice/src/features/promotions/components/PromotionListRow.tsx
//
// Single row in the backoffice promotions table. Inline active toggle, edit
// button, and (SUPER_ADMIN-only) soft-delete button.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §4.5, BO2

import { Pencil, Trash2 } from 'lucide-react';
import { Button, PromotionTypeBadge } from '@breakery/ui';
import type { PromotionListRow as PromotionListRowType } from '../hooks/usePromotionsList.js';

export interface PromotionListRowProps {
  row: PromotionListRowType;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: PromotionListRowType) => void;
  onToggleActive: (row: PromotionListRowType) => void;
  onDelete: (row: PromotionListRowType) => void;
}

export function PromotionListRow({
  row,
  canUpdate,
  canDelete,
  onEdit,
  onToggleActive,
  onDelete,
}: PromotionListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3">
        <div className="font-semibold text-text-primary">{row.name}</div>
        <div className="text-xs font-mono text-text-secondary">{row.slug}</div>
      </td>
      <td className="px-4 py-3">
        <PromotionTypeBadge type={row.type} />
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">{row.scope ?? '—'}</td>
      <td className="px-4 py-3 text-right font-mono">{row.priority}</td>
      <td className="px-4 py-3 text-center">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={row.is_active}
            disabled={!canUpdate}
            onChange={() => onToggleActive(row)}
            aria-label={`Toggle ${row.name} active`}
          />
          <span
            className={
              row.is_active ? 'text-green text-xs uppercase' : 'text-text-secondary text-xs uppercase'
            }
          >
            {row.is_active ? 'Active' : 'Inactive'}
          </span>
        </label>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canUpdate}
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.name}`}
          >
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </Button>
          {canDelete && (
            <Button
              type="button"
              variant="ghostDestructive"
              size="sm"
              onClick={() => onDelete(row)}
              aria-label={`Delete ${row.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
