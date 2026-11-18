// apps/backoffice/src/features/products/components/VariantRowSortable.tsx
//
// Session 27c — DnD-sortable row for the variants list. Mirrors the
// `CategorySortableRow` pattern shipped in S27b (Categories DnD page).
// Drag handle is gated by `canWrite` (no drag affordance for readers).
// S3-14 — bouton « Edit » (libellé), gaté comme « Delete ».

import type { JSX } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/BackofficeUi.js';
import { formatCurrency } from '@breakery/utils';
import type { VariantRow } from '../hooks/useProductVariants.js';

export interface VariantRowSortableProps {
  variant:        VariantRow;
  canWrite:       boolean;
  onDelete?:      (variant: VariantRow) => void;
  deletePending?: boolean;
  onEdit?:        (variant: VariantRow) => void;
}

export function VariantRowSortable({
  variant, canWrite, onDelete, deletePending = false, onEdit,
}: VariantRowSortableProps): JSX.Element {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: variant.id, disabled: !canWrite });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isDragging ? 'var(--bg-overlay, rgba(0,0,0,0.04))' : undefined,
  };

  const retail = formatCurrency(variant.retail_price);
  const cost   = variant.cost_price === 0
    ? '—'
    : formatCurrency(variant.cost_price);

  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-testid={`variant-row-${variant.id}`}
      className="border-t border-border-subtle"
    >
      <td className="px-2 py-2 w-8 text-center">
        <button
          type="button"
          aria-label={`Drag ${variant.variant_label}`}
          disabled={!canWrite}
          className="cursor-grab text-text-secondary hover:text-text-primary touch-none select-none px-1 disabled:cursor-not-allowed disabled:opacity-30"
          {...attributes}
          {...listeners}
          data-testid={`variant-drag-${variant.id}`}
        >
          <span aria-hidden className="font-mono leading-none">⋮⋮</span>
        </button>
      </td>
      <td className="px-3 py-2 font-medium text-text-primary">{variant.variant_label}</td>
      <td className="px-3 py-2 font-mono text-xs text-text-secondary">{variant.sku}</td>
      <td className="px-3 py-2 text-right font-mono text-text-primary">{retail}</td>
      <td className="px-3 py-2 text-right font-mono text-xs text-text-secondary">{cost}</td>
      <td className="px-3 py-2 text-center">
        <span
          className={
            variant.is_active
              ? 'text-xs font-semibold text-success'
              : 'text-xs font-semibold text-text-muted'
          }
        >
          {variant.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {canWrite && onEdit !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(variant)}
            data-testid={`variant-edit-${variant.id}`}
            aria-label={`Edit ${variant.variant_label}`}
          >
            Edit
          </Button>
        )}
        {canWrite && onDelete !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(variant)}
            disabled={deletePending}
            data-testid={`variant-delete-${variant.id}`}
            aria-label={`Delete ${variant.variant_label}`}
          >
            Delete
          </Button>
        )}
      </td>
    </tr>
  );
}
