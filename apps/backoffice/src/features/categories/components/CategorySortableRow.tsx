// apps/backoffice/src/features/categories/components/CategorySortableRow.tsx
// Session 27b — Sortable row for the Categories management page.
//
// Corps de texte — 2026-08-18. La pastille de type portait `text-[0.625rem]`
// (10 px), sous le plancher de la rampe (`--type-xs` = 12 px). Remontée à
// `text-xs`, comme les trois autres 10 px du même relevé (ChoiceGroupCard ×2,
// GeneralInfoSection).

import type { JSX } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { CategoryRow, CategoryType } from '../hooks/useAllCategories.js';

// La teinte catégorielle porte l'identité ; le libellé prend l'encre primaire.
// En texte plein sur son propre fond à 15 %, l'ambre tombait à 4,08:1 et
// l'émeraude à 4,43:1 — sous le seuil AA de 4,5:1 pour du 10 px (audit du
// 2026-08-11). Sur la même teinte, l'encre primaire donne 13,8 à 14,3:1 et la
// pastille garde sa couleur de catégorie à pleine force.
const TYPE_META: Record<CategoryType, { label: string; cls: string }> = {
  raw_material:  { label: 'Raw material',  cls: 'bg-cat-amber/15 text-text-primary' },
  semi_finished: { label: 'Semi-finished', cls: 'bg-cat-blue/15 text-text-primary' },
  finished:      { label: 'Finished',      cls: 'bg-cat-emerald/15 text-text-primary' },
};

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
          className={`cursor-grab text-text-secondary hover:text-text-primary touch-none select-none px-1 disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS_RING}`}
          {...attributes}
          {...listeners}
        >
          <span aria-hidden className="font-mono leading-none">⋮⋮</span>
        </button>
      </td>
      <td className="px-3 py-2">{category.name}</td>
      <td className="px-3 py-2 font-mono text-xs text-text-secondary">{category.slug}</td>
      <td className="px-3 py-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${TYPE_META[category.category_type].cls}`}>
          {TYPE_META[category.category_type].label}
        </span>
      </td>
      <td className="px-3 py-2 text-xs uppercase tracking-widest text-text-secondary">
        {category.dispatch_station} / {category.kds_station}
      </td>
      <td className="px-3 py-2 text-center">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
            category.show_in_pos ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
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
            category.is_active ? 'bg-success-soft text-success' : 'bg-surface-4 text-text-muted'
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
