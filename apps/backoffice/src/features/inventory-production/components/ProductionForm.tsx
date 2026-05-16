// apps/backoffice/src/features/inventory-production/components/ProductionForm.tsx
//
// Records a production batch via record_production_v1. Live feasibility
// preview powered by @breakery/domain's checkFeasibility() against the
// currently-fetched recipe + per-material current_stock from useFinishedProducts.
//
// Session 15 / Phase 2.B: split "quantity_produced" into expected vs actual
// yield. On submit, if |actual-expected|/expected*100 > business_config
// threshold AND no reason has been entered, open the YieldVarianceModal to
// collect a justification before re-submitting with `p_yield_variance_reason`.

import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input } from '@breakery/ui';
import { checkFeasibility } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { useFinishedProducts } from '../hooks/useFinishedProducts.js';
import { useRecipes } from '../hooks/useRecipes.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { useRecordProduction, RecordProductionError } from '../hooks/useRecordProduction.js';
import { FeasibilityBadge } from './FeasibilityBadge.js';
import { YieldVarianceModal } from './YieldVarianceModal.js';

/** Falls back to 15% if business_config row is missing or value invalid. */
const DEFAULT_THRESHOLD_PCT = 15;

function useYieldVarianceThresholdPct(): number {
  const q = useQuery({
    queryKey: ['business_config', 'production.yield_variance_threshold_pct'] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('production_yield_variance_threshold_pct')
        .eq('id', 1)
        .limit(1);
      if (error) throw error;
      const raw = (data?.[0] as { production_yield_variance_threshold_pct?: number | string | null } | undefined)
        ?.production_yield_variance_threshold_pct;
      if (raw === null || raw === undefined) return DEFAULT_THRESHOLD_PCT;
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return DEFAULT_THRESHOLD_PCT;
      // DB stores ratio (e.g. 0.15) ; convert to percentage if so.
      return num < 1 ? num * 100 : num;
    },
  });
  return q.data ?? DEFAULT_THRESHOLD_PCT;
}

export default function ProductionForm(): JSX.Element {
  const products = useFinishedProducts({ withRecipeOnly: true });
  const sections = useSections();
  const thresholdPct = useYieldVarianceThresholdPct();

  const [productId, setProductId] = useState<string>('');
  const [expectedQty, setExpectedQty] = useState<string>('');
  const [actualQty, setActualQty] = useState<string>('');
  const [waste, setWaste] = useState<string>('0');
  const [sectionId, setSectionId] = useState<string>('');
  const [batchNumber, setBatchNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [varianceModalOpen, setVarianceModalOpen] = useState(false);
  const [pendingReason, setPendingReason] = useState<string | null>(null);

  const recipes = useRecipes(productId === '' ? null : productId);

  const numericExpected = Number.parseFloat(expectedQty);
  const numericActual   = Number.parseFloat(actualQty);
  const numericWaste    = Number.parseFloat(waste) || 0;

  // The legacy "quantity_produced" RPC arg = actual yield (back-compat: server
  // defaults actual_yield_qty to quantity_produced when not provided).
  const qtyForFeasibility = Number.isFinite(numericActual) && numericActual > 0
    ? numericActual
    : (Number.isFinite(numericExpected) && numericExpected > 0 ? numericExpected : NaN);

  // Stock snapshot map (material_id → current_stock).
  const stockMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products.data ?? []) map[p.id] = p.current_stock;
    return map;
  }, [products.data]);

  const feasibility = useMemo(() => {
    if (recipes.data === undefined || recipes.data.length === 0) return null;
    if (!Number.isFinite(qtyForFeasibility) || qtyForFeasibility <= 0) return null;
    try {
      return checkFeasibility(recipes.data, qtyForFeasibility, stockMap, numericWaste);
    } catch {
      return null;
    }
  }, [recipes.data, stockMap, qtyForFeasibility, numericWaste]);

  const variancePct = useMemo(() => {
    if (!Number.isFinite(numericExpected) || numericExpected <= 0) return null;
    if (!Number.isFinite(numericActual)) return null;
    return ((numericActual - numericExpected) / numericExpected) * 100;
  }, [numericExpected, numericActual]);

  const exceedsThreshold = variancePct !== null && Math.abs(variancePct) > thresholdPct;

  const recordMut = useRecordProduction();

  const hasValidExpected = Number.isFinite(numericExpected) && numericExpected > 0;
  const hasValidActual   = Number.isFinite(numericActual)   && numericActual   >= 0;

  const canSubmit =
    productId !== '' &&
    hasValidExpected &&
    hasValidActual &&
    numericWaste >= 0 &&
    !recordMut.isPending;

  async function submitWithReason(reason: string | null): Promise<void> {
    setFormError(null);
    try {
      const args: {
        productId: string; quantityProduced: number; sectionId: string;
        quantityWaste: number; idempotencyKey: string;
        batchNumber?: string; notes?: string;
        expectedYieldQty?: number; actualYieldQty?: number;
        yieldVarianceReason?: string;
      } = {
        productId,
        // Back-compat: keep quantity_produced = actual yield (server defaults
        // actual_yield_qty := quantity_produced when not provided).
        quantityProduced: numericActual,
        sectionId,
        quantityWaste: numericWaste,
        idempotencyKey,
        expectedYieldQty: numericExpected,
        actualYieldQty:   numericActual,
      };
      const bt = batchNumber.trim();
      if (bt !== '') args.batchNumber = bt;
      const nt = notes.trim();
      if (nt !== '') args.notes = nt;
      if (reason !== null && reason.trim() !== '') {
        args.yieldVarianceReason = reason.trim();
      }
      const result = await recordMut.mutateAsync(args);
      setSuccessMsg(`Recorded ${result.production_number} (${result.movements_count} movements, ${result.je_count} JEs)`);
      setExpectedQty(''); setActualQty(''); setWaste('0'); setBatchNumber(''); setNotes('');
      setPendingReason(null);
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      if (err instanceof RecordProductionError) {
        const detail = err.missingDetail;
        if (err.code === 'insufficient_stock' && Array.isArray(detail)) {
          const list = (detail as Array<{ material_name: string; shortfall: number; unit: string }>)
            .map((d) => `${d.material_name} short ${d.shortfall} ${d.unit}`)
            .join('; ');
          setFormError(`Insufficient stock: ${list}`);
        } else if (err.code === 'variance_reason_too_short') {
          setFormError('Yield variance reason must be at least 5 characters.');
        } else {
          setFormError(`Error: ${err.code}`);
        }
      } else {
        setFormError('Failed to record production.');
      }
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError(null);

    // Gate: variance > threshold AND no reason yet → open modal.
    if (exceedsThreshold && pendingReason === null) {
      setVarianceModalOpen(true);
      return;
    }
    await submitWithReason(pendingReason);
  }

  function handleVarianceConfirm(reason: string): void {
    setPendingReason(reason);
    setVarianceModalOpen(false);
    void submitWithReason(reason);
  }

  function handleVarianceCancel(): void {
    setVarianceModalOpen(false);
  }

  // When user edits the form again after entering a reason, reset it so a
  // fresh variance check happens on next submit.
  useEffect(() => {
    setPendingReason(null);
  }, [productId, expectedQty, actualQty, waste]);

  // Clear success after 3s.
  useEffect(() => {
    if (successMsg === null) return;
    const t = setTimeout(() => setSuccessMsg(null), 3000);
    return () => clearTimeout(t);
  }, [successMsg]);

  return (
    <>
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
            <label className="text-xs uppercase tracking-widest text-text-secondary">Expected yield</label>
            <Input type="number" inputMode="decimal" min={0.001} step="0.001"
              value={expectedQty} onChange={(e) => setExpectedQty(e.target.value)}
              disabled={recordMut.isPending} />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-text-secondary flex items-center gap-2">
              <span>Actual yield</span>
              {hasValidExpected && (
                <span
                  className="inline-flex items-center rounded bg-bg-input px-1.5 py-0.5 text-[10px] font-mono text-text-secondary"
                  data-testid="expected-badge"
                >
                  exp {numericExpected.toLocaleString()}
                </span>
              )}
            </label>
            <Input type="number" inputMode="decimal" min={0} step="0.001"
              value={actualQty} onChange={(e) => setActualQty(e.target.value)}
              disabled={recordMut.isPending} />
            {variancePct !== null && (
              <div
                data-testid="variance-display"
                className={`text-[11px] font-mono ${exceedsThreshold ? 'text-red-600 font-semibold' : 'text-text-secondary'}`}
              >
                variance {variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%
                {exceedsThreshold && <> (over ±{thresholdPct.toFixed(1)}%)</>}
              </div>
            )}
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

      {varianceModalOpen && hasValidExpected && hasValidActual && (
        <YieldVarianceModal
          expectedQty={numericExpected}
          actualQty={numericActual}
          thresholdPct={thresholdPct}
          onCancel={handleVarianceCancel}
          onConfirm={handleVarianceConfirm}
        />
      )}
    </>
  );
}
