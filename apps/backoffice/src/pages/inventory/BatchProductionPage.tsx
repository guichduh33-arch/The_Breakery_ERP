// apps/backoffice/src/pages/inventory/BatchProductionPage.tsx
//
// Session 15 / Phase 4.A — Batch production at /backoffice/inventory/production/batch.
//
// Plan multiple recipes in a single atomic transaction via
// record_batch_production_v1. Any failure (insufficient stock on any item,
// invalid input, permission denied) rolls back the whole batch — no partial
// production_records. Permission-gated by `inventory.production.create` at
// the route level.

import { useMemo, useState, type FormEvent, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { BatchSelector, type BatchItem } from '@/features/inventory-production/components/BatchSelector.js';
import { IngredientAggregatePreview } from '@/features/inventory-production/components/IngredientAggregatePreview.js';
import {
  useRecordBatchProduction,
  RecordBatchProductionError,
  type BatchItemInput,
} from '@/features/inventory-production/hooks/useRecordBatchProduction.js';

function emptyRow(): BatchItem {
  return {
    rowId:            crypto.randomUUID(),
    productId:        null,
    productName:      null,
    productUnit:      null,
    quantityProduced: '',
    quantityWaste:    '0',
  };
}

export default function BatchProductionPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate     = hasPermission('inventory.production.create');

  const sections = useSections();
  const recordMut = useRecordBatchProduction();

  const [items, setItems]                 = useState<BatchItem[]>(() => [emptyRow()]);
  const [sectionId, setSectionId]         = useState<string>('');
  const [notes, setNotes]                 = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [formError, setFormError]         = useState<string | null>(null);
  const [shortages, setShortages]         = useState<Array<{ material_name: string; shortfall: number; unit: string }> | null>(null);
  const [successMsg, setSuccessMsg]       = useState<string | null>(null);

  const excludeIdsByRow = useMemo(() => {
    const allChosen = items.filter((it) => it.productId !== null).map((it) => it.productId as string);
    return items.map((it) => {
      // For a given row, exclude every OTHER row's chosen product so two rows
      // can't pick the same finished product. (D10 — keep batch composition
      // distinct ; if user wants to produce 2x quantity, use a single row.)
      return allChosen.filter((pid) => pid !== it.productId);
    });
  }, [items]);

  const submittableItems: BatchItemInput[] = useMemo(() => {
    return items
      .filter((it) => {
        if (it.productId === null) return false;
        const q = Number.parseFloat(it.quantityProduced);
        return Number.isFinite(q) && q > 0;
      })
      .map((it) => {
        const q   = Number.parseFloat(it.quantityProduced);
        const w   = Number.parseFloat(it.quantityWaste) || 0;
        const out: BatchItemInput = {
          productId:        it.productId as string,
          quantityProduced: q,
        };
        if (w > 0) out.quantityWaste = w;
        return out;
      });
  }, [items]);

  const canSubmit = submittableItems.length > 0 && sectionId !== '' && !recordMut.isPending;

  function addRow(): void {
    setItems((prev) => [...prev, emptyRow()]);
  }

  function removeRow(rowId: string): void {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((it) => it.rowId !== rowId)));
  }

  function updateRow(next: BatchItem): void {
    setItems((prev) => prev.map((it) => (it.rowId === next.rowId ? next : it)));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    setShortages(null);
    try {
      const args: {
        idempotencyKey: string;
        items: BatchItemInput[];
        notes?: string;
        sectionId?: string;
      } = { idempotencyKey, items: submittableItems };
      const trimmedNotes = notes.trim();
      if (trimmedNotes !== '') args.notes = trimmedNotes;
      // sectionId is required (canSubmit gates on sectionId !== '').
      args.sectionId = sectionId;
      const result = await recordMut.mutateAsync(args);
      setSuccessMsg(`Recorded ${result.batch_number} (${result.production_records.length} items)`);
      setItems([emptyRow()]);
      setNotes('');
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      if (err instanceof RecordBatchProductionError) {
        if (err.code === 'insufficient_stock' && Array.isArray(err.missingDetail)) {
          const list = err.missingDetail as Array<{ material_name: string; shortfall: number; unit: string }>;
          setShortages(list);
          setFormError('Insufficient stock for one or more ingredients.');
        } else if (err.code === 'forbidden') {
          setFormError('You do not have permission to create production batches.');
        } else if (err.code === 'recipe_not_found') {
          setFormError('At least one item references a product without an active recipe.');
        } else if (err.code === 'items_must_be_non_empty_array') {
          setFormError('Add at least one recipe.');
        } else {
          setFormError(`Error: ${err.code}`);
        }
      } else {
        setFormError('Failed to record batch production.');
      }
    }
  }

  if (!canCreate) {
    return (
      <div className="text-text-secondary">
        You do not have permission to create production batches.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Batch production</h1>
        <p className="text-text-secondary text-sm mt-1">
          Plan multiple recipes in one atomic transaction. Any failure (insufficient
          stock on any item, invalid input) rolls back the whole batch.
        </p>
      </div>

      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        noValidate
        className="space-y-4"
      >
        {formError !== null && (
          <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
            {formError}
            {shortages !== null && (
              <ul className="mt-1 list-disc pl-5" data-testid="shortages-list">
                {shortages.map((s, idx) => (
                  <li key={idx}>
                    {s.material_name} short {s.shortfall} {s.unit}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {successMsg !== null && (
          <div role="status" className="rounded-md border border-success/40 bg-success-soft p-2 text-xs text-success">
            {successMsg}
          </div>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl">Items</h2>
            <Button type="button" variant="ghost" onClick={addRow} disabled={recordMut.isPending}>
              + Add recipe
            </Button>
          </div>

          <div className="space-y-3" data-testid="batch-items">
            {items.map((it, idx) => (
              <BatchSelector
                key={it.rowId}
                value={it}
                onChange={updateRow}
                onRemove={() => removeRow(it.rowId)}
                removable={items.length > 1}
                disabled={recordMut.isPending}
                excludeIds={excludeIdsByRow[idx] ?? []}
              />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <IngredientAggregatePreview items={items} />
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-text-secondary">Section</label>
            <select
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={recordMut.isPending}
              aria-label="Section"
              required
            >
              <option value="">— select section —</option>
              {(sections.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-text-secondary">Notes (optional)</label>
            <input
              type="text"
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              disabled={recordMut.isPending}
              aria-label="Notes"
            />
          </div>
        </section>

        <div className="flex justify-end pt-2">
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {recordMut.isPending ? 'Submitting…' : 'Record batch'}
          </Button>
        </div>
      </form>
    </div>
  );
}
