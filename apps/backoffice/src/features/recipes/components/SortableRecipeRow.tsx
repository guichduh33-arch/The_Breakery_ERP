//
// Pill-styled, drag-sortable recipe row for the product-tab RecipeBuilder.
// Mirrors the original product-tab row look (mono pills for qty/unit) and adds
// a @dnd-kit drag handle + remove button. Reorder + remove are hidden in
// readOnly mode.

import { GripVertical, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RecipeRow } from '@breakery/domain';

export interface SortableRecipeRowProps {
  row: RecipeRow;
  readOnly: boolean;
  isRemoving: boolean;
  onRemove: (recipeId: string) => void;
}

export function SortableRecipeRow({
  row,
  readOnly,
  isRemoving,
  onRemove,
}: SortableRecipeRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.recipe_id, disabled: readOnly });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-t border-border-subtle"
      data-testid={`recipe-row-${row.recipe_id}`}
    >
      {!readOnly && (
        <td className="w-8 px-2 py-3 text-center">
          <button
            type="button"
            aria-label={`Drag ${row.material_name}`}
            className="cursor-grab touch-none select-none text-text-muted hover:text-text-primary"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        </td>
      )}
      <td className="px-4 py-3 text-text-primary">
        <div className="font-display text-base">{row.material_name}</div>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="rounded-md border border-border-subtle bg-bg-input px-3 py-1 font-mono tabular-nums text-text-primary">
          {Number(row.quantity).toLocaleString()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="rounded-md border border-border-subtle bg-bg-input px-3 py-1 font-mono text-text-secondary">
          {row.unit}
        </span>
      </td>
      {!readOnly && (
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            aria-label={`Remove ${row.material_name}`}
            onClick={() => onRemove(row.recipe_id)}
            disabled={isRemoving}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-red-soft hover:text-red disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </td>
      )}
    </tr>
  );
}
