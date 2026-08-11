// apps/backoffice/src/pages/categories/CategoriesPage.tsx
// Session 27b — Categories management page with DnD reorder + create/edit.

import { useEffect, useRef, useState, type JSX } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@breakery/ui';
import { Plus } from 'lucide-react';
import {
  useAllCategories,
  type CategoryRow,
} from '@/features/categories/hooks/useAllCategories.js';
import {
  useReorderCategories,
  useUpdateCategory,
} from '@/features/categories/hooks/useCategoryMutations.js';
import { CategorySortableRow } from '@/features/categories/components/CategorySortableRow.js';
import { CategoryFormDialog } from '@/features/categories/components/CategoryFormDialog.js';
import { DeleteCategoryDialog } from '@/features/categories/components/DeleteCategoryDialog.js';
import { useAuthStore } from '@/stores/authStore.js';

export default function CategoriesPage(): JSX.Element {
  const cats = useAllCategories();
  const reorder = useReorderCategories();
  const updateCat = useUpdateCategory();
  const canCreate = useAuthStore((s) => s.hasPermission('categories.create'));
  const canEdit = useAuthStore((s) => s.hasPermission('categories.update'));
  const canDelete = useAuthStore((s) => s.hasPermission('categories.delete'));

  const [order, setOrder] = useState<CategoryRow[]>([]);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  useEffect(() => {
    if (cats.data) setOrder(cats.data);
  }, [cats.data]);

  // The three dialogs are mounted conditionally, so the whole subtree — Radix
  // focus scope included — is torn down in one commit and its focus return
  // never runs. Remember the trigger ourselves and restore it once the dialog
  // is gone, or Escape drops a keyboard user at the top of the document.
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogOpen = showCreate || editing !== null || deleting !== null;

  function rememberTrigger() {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  useEffect(() => {
    if (dialogOpen) return;
    const trigger = triggerRef.current;
    if (trigger === null) return;
    triggerRef.current = null;
    trigger.focus();
  }, [dialogOpen]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over === null || active.id === over.id) return;
    const oldIdx = order.findIndex((c) => c.id === String(active.id));
    const newIdx = order.findIndex((c) => c.id === String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(order, oldIdx, newIdx);
    setOrder(next);
    setReorderError(null);
    reorder.mutate(
      next.map((c) => c.id),
      {
        onError: (err) => {
          setReorderError(err.message);
          // Roll back local order on error.
          if (cats.data) setOrder(cats.data);
        },
      },
    );
  }

  function handleToggleActive(c: CategoryRow) {
    updateCat.mutate({
      categoryId: c.id,
      patch: { is_active: !c.is_active },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.4375rem] font-semibold leading-tight tracking-[-0.015em] text-text-primary">Product categories</h1>
          <p id="categories-order-hint" className="text-sm text-text-secondary italic">
            Rows are in display order on the POS grid. Drag a row, or focus its handle and use the
            arrow keys, to reorder.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => { rememberTrigger(); setShowCreate(true); }}
            data-testid="categories-new-btn"
            className="inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New category
          </Button>
        )}
      </div>

      {reorderError !== null && (
        <div role="alert" className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red">
          Reorder failed: {reorderError}
        </div>
      )}

      {cats.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {!cats.isLoading && order.length === 0 && (
        <p className="text-sm text-text-secondary">No categories yet.</p>
      )}

      {order.length > 0 && (
        // `DndContext` enveloppe la table et non son contenu : monté entre
        // <thead> et <tbody>, dnd-kit y rendait sa région live en ligne, ce qui
        // posait deux <div> enfants directs de <table> — DOM invalide, et une
        // région live à l'intérieur d'une structure tabulaire.
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="categories-table"
                aria-describedby="categories-order-hint"
              >
                <caption className="sr-only">
                  Product categories, in the order they appear on the POS grid.
                </caption>
                <thead>
                  <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                    <th scope="col" className="px-2 py-2 w-8"><span className="sr-only">Reorder</span></th>
                    <th scope="col" className="px-3 py-2">Name</th>
                    <th scope="col" className="px-3 py-2">Slug</th>
                    <th scope="col" className="px-3 py-2">Type</th>
                    <th scope="col" className="px-3 py-2">Dispatch / KDS</th>
                    <th scope="col" className="px-3 py-2 text-center">POS</th>
                    <th scope="col" className="px-3 py-2 text-center">Active</th>
                    <th scope="col" className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {order.map((c) => (
                    <CategorySortableRow
                      key={c.id}
                      category={c}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      onEdit={(cat) => { rememberTrigger(); setEditing(cat); }}
                      onDelete={(cat) => { rememberTrigger(); setDeleting(cat); }}
                      onToggleActive={handleToggleActive}
                      togglePending={updateCat.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </SortableContext>
        </DndContext>
      )}

      {showCreate && (
        <CategoryFormDialog mode="create" onClose={() => setShowCreate(false)} />
      )}
      {editing !== null && (
        <CategoryFormDialog
          mode="edit"
          category={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting !== null && (
        <DeleteCategoryDialog
          category={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
