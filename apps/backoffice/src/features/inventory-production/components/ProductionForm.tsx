// apps/backoffice/src/features/inventory-production/components/ProductionForm.tsx
//
// Records a production batch via record_production_v1. Live feasibility
// preview powered by @breakery/domain's checkFeasibility() against the
// currently-fetched recipe + per-material current_stock from useFinishedProducts.

import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
import { checkFeasibility } from '@breakery/domain';
import { useFinishedProducts } from '../hooks/useFinishedProducts.js';
import { useRecipes } from '../hooks/useRecipes.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { useRecordProduction, RecordProductionError } from '../hooks/useRecordProduction.js';
import { FeasibilityBadge } from './FeasibilityBadge.js';

export default function ProductionForm(): JSX.Element {
  const products = useFinishedProducts({ withRecipeOnly: true });
  const sections = useSections();

  const [productId, setProductId] = useState<string>('');
  const [qty, setQty] = useState<string>('');
  const [waste, setWaste] = useState<string>('0');
  const [sectionId, setSectionId] = useState<string>('');
  const [batchNumber, setBatchNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const recipes = useRecipes(productId === '' ? null : productId);

  const numericQty = Number.parseFloat(qty);
  const numericWaste = Number.parseFloat(waste) || 0;

  // Stock snapshot map (material_id → current_stock).
  const stockMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products.data ?? []) map[p.id] = p.current_stock;
    return map;
  }, [products.data]);

  const feasibility = useMemo(() => {
    if (recipes.data === undefined || recipes.data.length === 0) return null;
    if (!Number.isFinite(numericQty) || numericQty <= 0) return null;
    try {
      return checkFeasibility(recipes.data, numericQty, stockMap, numericWaste);
    } catch {
      return null;
    }
  }, [recipes.data, stockMap, numericQty, numericWaste]);

  const recordMut = useRecordProduction();

  const canSubmit =
    productId !== '' &&
    Number.isFinite(numericQty) && numericQty > 0 &&
    numericWaste >= 0 &&
    !recordMut.isPending;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    try {
      const args: {
        productId: string; quantityProduced: number; sectionId: string;
        quantityWaste: number; idempotencyKey: string;
        batchNumber?: string; notes?: string;
      } = {
        productId,
        quantityProduced: numericQty,
        sectionId,
        quantityWaste: numericWaste,
        idempotencyKey,
      };
      const bt = batchNumber.trim();
      if (bt !== '') args.batchNumber = bt;
      const nt = notes.trim();
      if (nt !== '') args.notes = nt;
      const result = await recordMut.mutateAsync(args);
      setSuccessMsg(`Recorded ${result.production_number} (${result.movements_count} movements, ${result.je_count} JEs)`);
      setQty(''); setWaste('0'); setBatchNumber(''); setNotes('');
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      if (err instanceof RecordProductionError) {
        const detail = err.missingDetail;
        if (err.code === 'insufficient_stock' && Array.isArray(detail)) {
          const list = (detail as Array<{ material_name: string; shortfall: number; unit: string }>)
            .map((d) => `${d.material_name} short ${d.shortfall} ${d.unit}`)
            .join('; ');
          setFormError(`Insufficient stock: ${list}`);
        } else {
          setFormError(`Error: ${err.code}`);
        }
      } else {
        setFormError('Failed to record production.');
      }
    }
  }

  // Clear success after 3s.
  useEffect(() => {
    if (successMsg === null) return;
    const t = setTimeout(() => setSuccessMsg(null), 3000);
    return () => clearTimeout(t);
  }, [successMsg]);

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      noValidate
      className="space-y-4 max-w-2xl bg-bg-elevated border border-border-subtle rounded-lg p-6"
    >
      {formError !== null && (
        <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
          {formError}
        </div>
      )}
      {successMsg !== null && (
        <div role="status" className="rounded-md border border-success/40 bg-success-soft p-2 text-xs text-success">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 col-span-2">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Finished product</label>
          <select
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
            value={productId} onChange={(e) => setProductId(e.target.value)}
            disabled={recordMut.isPending}
          >
            <option value="">— select —</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.unit}) — stock {p.current_stock}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Quantity produced</label>
          <Input type="number" inputMode="decimal" min={0.001} step="0.001"
            value={qty} onChange={(e) => setQty(e.target.value)} disabled={recordMut.isPending} />
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Waste (optional)</label>
          <Input type="number" inputMode="decimal" min={0} step="0.001"
            value={waste} onChange={(e) => setWaste(e.target.value)} disabled={recordMut.isPending} />
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Section (optional)</label>
          <select
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
            value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={recordMut.isPending}
          >
            <option value="">— none —</option>
            {(sections.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Batch number (optional)</label>
          <Input type="text" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)}
            disabled={recordMut.isPending} maxLength={64} />
        </div>

        <div className="space-y-1 col-span-2">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Notes (optional)</label>
          <Input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            disabled={recordMut.isPending} maxLength={500} />
        </div>
      </div>

      <FeasibilityBadge result={feasibility} />

      <div className="flex justify-end pt-2">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {recordMut.isPending ? 'Recording…' : 'Record production'}
        </Button>
      </div>
    </form>
  );
}
