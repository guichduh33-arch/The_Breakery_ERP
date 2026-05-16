// apps/backoffice/src/features/inventory-production/components/RecipeRowSortable.tsx
//
// Session 15 / Phase 3.B — sortable <tr> for RecipeEditor's BoM table.
//
// Each row exposes a keyboard-and-mouse drag handle (the leftmost cell).
// Wraps `useSortable` from `@dnd-kit/sortable`. Composition pattern : the
// parent owns `DndContext` + `SortableContext`, this component handles only
// per-row state.

import type { JSX } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@breakery/ui';
import type { RecipeRow } from '@breakery/domain';

export interface RecipeRowSortableProps {
  row: RecipeRow;
  onRemove: (recipeId: string) => void;
  isRemoving: boolean;
}

export function RecipeRowSortable({
  row,
  onRemove,
  isRemoving,
}: RecipeRowSortableProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.recipe_id });

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
      className="border-t border-border-subtle"
      data-testid={`recipe-row-${row.recipe_id}`}
    >
      <td className="px-2 py-2 w-8 text-center">
        <button
          type="button"
          aria-label={`Drag ${row.material_name}`}
          className="cursor-grab text-text-secondary hover:text-text-primary touch-none select-none px-1"
          {...attributes}
          {...listeners}
        >
          {/* Pure-CSS drag handle — six-dot pattern */}
          <span aria-hidden className="font-mono leading-none">⋮⋮</span>
        </button>
      </td>
      <td className="px-3 py-2">{row.material_name}</td>
      <td className="px-3 py-2 text-right font-mono">
        {Number(row.quantity).toLocaleString()}
      </td>
      <td className="px-3 py-2">{row.unit}</td>
      <td className="px-3 py-2 text-right font-mono">
        {Number(row.material_cost_price).toLocaleString()} /{row.material_unit}
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(row.recipe_id)}
          disabled={isRemoving}
        >
          Remove
        </Button>
      </td>
    </tr>
  );
}

export default RecipeRowSortable;
