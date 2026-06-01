// apps/backoffice/src/features/products/components/VariantsPanel.tsx
//
// Session 27c — 3-case switch root for the Variants tab in ProductDetailPage.
//
//   Case 1 — Standalone: product has no parent AND no children → EmptyState
//            with "Convert to parent + create first variant" CTA.
//   Case 2 — Parent: product has children → table of variants with DnD reorder,
//            add-variant + dissolve actions.
//   Case 3 — Variant: product has a parent → read-only banner with link back
//            to the parent.
//
// All write actions are gated on `products.variants.write`.

import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Layers, Plus } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { Badge, Button, EmptyState } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useProductVariants, type VariantRow } from '../hooks/useProductVariants.js';
import { useProductParent } from '../hooks/useProductParent.js';
import { useReorderVariants } from '../hooks/useReorderVariants.js';
import { useDeleteVariant } from '../hooks/useDeleteVariant.js';
import { VariantRowSortable } from './VariantRowSortable.js';
import { ConvertToParentDialog } from './ConvertToParentDialog.js';
import { AddVariantDialog } from './AddVariantDialog.js';
import { DissolveParentDialog } from './DissolveParentDialog.js';

export interface VariantsPanelProduct {
  id:                 string;
  name:               string;
  parent_product_id:  string | null;
  variant_label:      string | null;
  variant_axis:       string | null;
}

export interface VariantsPanelProps {
  product: VariantsPanelProduct;
}

export function VariantsPanel({ product }: VariantsPanelProps): JSX.Element {
  const navigate = useNavigate();
  const canWrite = useAuthStore((s) => s.hasPermission('products.variants.write'));

  // Case 3 → product is itself a variant. Don't query children.
  const isVariant = product.parent_product_id !== null;

  const variantsQuery = useProductVariants(isVariant ? null : product.id);
  const parentQuery   = useProductParent(product.parent_product_id);
  const reorderMut    = useReorderVariants();
  const deleteMut     = useDeleteVariant();

  const [convertOpen,  setConvertOpen]  = useState(false);
  const [addOpen,      setAddOpen]      = useState(false);
  const [dissolveOpen, setDissolveOpen] = useState(false);

  const variants: ReadonlyArray<VariantRow> = variantsQuery.data ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd(e: DragEndEvent): Promise<void> {
    const { active, over } = e;
    if (over === null || over === undefined || active.id === over.id) return;
    const oldIdx = variants.findIndex((v) => v.id === active.id);
    const newIdx = variants.findIndex((v) => v.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove([...variants], oldIdx, newIdx);
    try {
      await reorderMut.mutateAsync({
        parentId:   product.id,
        // reorder_variants_v1's complete-coverage gate counts only is_active=true
        // variants; soft-deleted (is_active=false) rows must be excluded from the
        // payload or every reorder fails with `incomplete_coverage` once a parent
        // has ever had a variant soft-deleted. Their relative order is preserved.
        orderedIds: reordered.filter((v) => v.is_active).map((v) => v.id),
      });
    } catch {
      // React Query invalidates on success — failure leaves the server order
      // intact; the next refetch will roll the UI back.
    }
  }

  // ── Case 3: this product IS a variant — read-only banner
  if (isVariant) {
    const parent = parentQuery.data;
    return (
      <div className="space-y-4">
        <div
          data-testid="variant-banner"
          className="flex items-center gap-3 rounded-lg border border-gold/30 bg-gold-soft p-4"
        >
          <Layers className="h-5 w-5 text-gold" aria-hidden />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">
              This product is a variant of "{parent?.name ?? '…'}"
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              Axis: <Badge variant="outline">{product.variant_axis ?? 'unknown'}</Badge>
              {' '}· Label: <strong className="text-text-primary">{product.variant_label ?? '—'}</strong>
            </p>
          </div>
          {parent !== undefined && parent !== null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/backoffice/products/${parent.id}`)}
              data-testid="variant-banner-view-parent"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" aria-hidden />
              View parent
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Case 1: standalone — empty state with "Convert" CTA
  if (variants.length === 0) {
    return (
      <>
        <EmptyState
          icon={Layers}
          title="No variants yet"
          description="Convert this product into a parent to start creating variants (sizes, flavors, or formats)."
          size="lg"
          data-testid="variants-empty-state"
          action={
            canWrite ? (
              <Button
                variant="gold"
                onClick={() => setConvertOpen(true)}
                data-testid="convert-to-parent-cta"
              >
                <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
                Convert to parent + create first variant
              </Button>
            ) : null
          }
        />
        {canWrite && (
          <ConvertToParentDialog
            open={convertOpen}
            onOpenChange={setConvertOpen}
            productId={product.id}
            productName={product.name}
          />
        )}
      </>
    );
  }

  // ── Case 2: parent — variants table
  const axis = variants[0]?.variant_axis ?? 'flavor';
  const activeVariants = variants.filter((v) => v.is_active);
  const showDissolveCta = activeVariants.length <= 1 && canWrite;

  return (
    <div className="space-y-4" data-testid="variants-parent-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline">{axis}</Badge>
          <span className="text-sm text-text-secondary">
            {variants.length} variant{variants.length === 1 ? '' : 's'}
          </span>
        </div>
        {canWrite && (
          <Button
            variant="gold"
            size="sm"
            onClick={() => setAddOpen(true)}
            data-testid="add-variant-cta"
          >
            <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
            Add variant
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => { void handleDragEnd(e); }}>
          <table className="w-full text-sm" data-testid="variants-table">
            <thead className="bg-bg-overlay text-left text-xs uppercase tracking-wider text-text-secondary">
              <tr>
                <th className="px-2 py-2 w-8"></th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-right">Retail</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              <SortableContext items={variants.map((v) => v.id)} strategy={verticalListSortingStrategy}>
                {variants.map((v) => (
                  <VariantRowSortable
                    key={v.id}
                    variant={v}
                    canWrite={canWrite}
                    onDelete={(va) => deleteMut.mutate(va.id)}
                    deletePending={deleteMut.isPending}
                  />
                ))}
              </SortableContext>
            </tbody>
          </table>
        </DndContext>
      </div>

      {showDissolveCta && (
        <div className="border-t border-border-subtle pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDissolveOpen(true)}
            data-testid="dissolve-parent-cta"
          >
            Dissolve parent (this product will become standalone again)
          </Button>
        </div>
      )}

      {canWrite && (
        <>
          <AddVariantDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            parentId={product.id}
            parentName={product.name}
          />
          <DissolveParentDialog
            open={dissolveOpen}
            onOpenChange={setDissolveOpen}
            parentId={product.id}
            parentName={product.name}
            lastVariantName={activeVariants[0]?.variant_label ?? null}
          />
        </>
      )}
    </div>
  );
}
