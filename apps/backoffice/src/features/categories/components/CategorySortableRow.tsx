// apps/backoffice/src/features/categories/components/CategorySortableRow.tsx
// Session 27b — Sortable row for the Categories management page.

import type { JSX } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@breakery/ui';
import type { CategoryRow } from '../hooks/useAllCategories.js';

export interface CategorySortableRowProps {
  category: CategoryRow;
  canEdit:  boolean;
  canDelete: boolean;
  onEdit:   (c: CategoryRow) => void;
  onDelete: (c: CategoryRow) => void;
  onToggleActive: (c: CategoryRow) => void;
  togglePending:  boolean;
}

export function CategorySortableRow({
  category, canEdit, canDelete, onEdit, onDelete, onToggleActive, togglePending,
}: CategorySortableRowProps): JSX.Element {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: category.id, disabled: !canEdit });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isDragging ? 'var(--bg-overlay, rgba(0,0,0,0.04))' : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-testid={`category-row-${category.id}`}
      className="border-t border-border-subtle"
    >
      <td className="px-2 py-2 w-8 text-center">
        <button
          type="button"
          aria-label={`Drag ${category.name}`}
          disabled={!canEdit}
          className="cursor-grab text-text-secondary hover:text-text-primary touch-none select-none px-1 disabled:cursor-not-allowed disabled:opacity-30"
          {...attributes}
          {...listeners}
        >
          <span aria-hidden className="font-mono leading-none">⋮⋮</span>
        </button>
      </td>
      <td className="px-3 py-2">{category.name}</td>
      <td className="px-3 py-2 font-mono text-xs text-text-secondary">{category.slug}</td>
      <td className="px-3 py-2 text-xs uppercase tracking-widest text-text-secondary">
        {category.dispatch_station} / {category.kds_station}
      </td>
      <td className="px-3 py-2 text-center">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
            category.show_in_pos ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}
          aria-label={category.show_in_pos ? 'Visible in POS' : 'Hidden from POS'}
          title={category.show_in_pos ? 'Visible in POS' : 'Hidden from POS'}
        >
          {category.show_in_pos ? '✓' : '✗'}
        </span>
      </td>
      <td className="px-3 py-2 text-center">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
            category.is_active ? 'bg-green-100 text-green-700' : 'bg-bg-overlay text-text-muted'
          }`}
          aria-label={category.is_active ? 'Active' : 'Inactive'}
        >
          {category.is_active ? '✓' : '✗'}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => onEdit(category)} disabled={!canEdit}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleActive(category)}
            disabled={!canEdit || togglePending}
          >
            {category.is_active ? 'Hide' : 'Activate'}
          </Button>
          {canDelete && (
            <Button
              variant="ghostDestructive"
              size="sm"
              onClick={() => onDelete(category)}
              data-testid={`category-delete-${category.id}`}
            >
              Delete
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
