// apps/backoffice/src/features/products/components/UnitsPanel.tsx
//
// Session 39 — Wave B1 — UnitsPanel write-mode via set_product_units_v1 (BO-09).
// Replaces the S14 read-only stub that used SAMPLE_ALT_UNITS.
//
// Reads real data from product_unit_alternatives + product_unit_contexts (S27).
// Editable alts list + 4 context selects + dirty flag + Save button.
// Gate: products.units.update — without the perm, inputs are disabled, no Save.

import { AlertTriangle, BookOpen, Box, ClipboardList, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Card, SectionLabel } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useProductUnits, type ProductUnitAlt, type ProductUnitContexts } from '../hooks/useProductUnits.js';
import { useSetProductUnits } from '../hooks/useSetProductUnits.js';
import { useSetProductBaseUnit } from '../hooks/useSetProductBaseUnit.js';
import type { ProductRow } from '../types.js';

// Common base/stock units offered in the selector. The product's current unit is
// always merged in first so a non-standard legacy unit (e.g. 'cup', 'Bag') stays
// selectable. Metric units here ARE convertible (see unit_conversions).
const COMMON_BASE_UNITS = ['kg', 'g', 'gr', 'mg', 'lt', 'L', 'ml', 'mL', 'pcs'];

interface Props {
  product: ProductRow;
}

/** Build an initial contexts object, falling back to baseUnit for every field. */
function defaultContexts(base: string, saved: ProductUnitContexts | null): ProductUnitContexts {
  return {
    stock_opname_unit: saved?.stock_opname_unit ?? base,
    recipe_unit:       saved?.recipe_unit       ?? base,
    purchase_unit:     saved?.purchase_unit     ?? base,
    sales_unit:        saved?.sales_unit        ?? base,
  };
}

/** Draft alt with a stable local key for React list rendering. */
interface DraftAlt extends ProductUnitAlt {
  _key: string;
}

let _keyCounter = 0;
function newKey() { return `alt-${++_keyCounter}`; }

function toDraft(alt: ProductUnitAlt): DraftAlt {
  return { ...alt, _key: newKey() };
}

/** True when two alternatives arrays are semantically equal (order matters). */
function altsEqual(a: ProductUnitAlt[], b: ProductUnitAlt[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return x.code === y.code && x.factor_to_base === y.factor_to_base;
  });
}

function contextsEqual(a: ProductUnitContexts, b: ProductUnitContexts): boolean {
  return (
    a.stock_opname_unit === b.stock_opname_unit &&
    a.recipe_unit       === b.recipe_unit &&
    a.purchase_unit     === b.purchase_unit &&
    a.sales_unit        === b.sales_unit
  );
}

export function UnitsPanel({ product }: Props): JSX.Element {
  const canWrite = useAuthStore((s) => s.hasPermission('products.units.update'));
  const { data, isLoading, error } = useProductUnits(product.id);
  const setUnits = useSetProductUnits(product.id);
  const setBaseUnit = useSetProductBaseUnit(product.id);

  const baseUnit = product.unit;

  // ── Base unit draft (separate, deliberate action — it resets alts & contexts) ─
  const [baseDraft, setBaseDraft] = useState<string>(baseUnit);
  useEffect(() => { setBaseDraft(baseUnit); }, [baseUnit]);
  const baseChanged = baseDraft !== baseUnit;

  const baseUnitOptions = useMemo(
    () => Array.from(new Set([baseUnit, ...COMMON_BASE_UNITS].filter(Boolean))),
    [baseUnit],
  );

  function applyBaseUnit(): void {
    setBaseUnit.mutate(baseDraft, {
      onSuccess: (res) => {
        toast.success(
          `Base unit changed to ${res.new_unit}.` +
            (res.cost_price_converted ? '' : ' Cost price kept as-is — review it.'),
        );
      },
      onError: (err) => {
        const msg = err.message.includes('base_unit_change_requires_zero_stock')
          ? 'Cannot change the base unit: this product still has stock or stock movements. Zero them out first.'
          : `Failed to change base unit: ${err.message}`;
        toast.error(msg);
      },
    });
  }

  const [draftAlts, setDraftAlts] = useState<DraftAlt[]>([]);
  const [draftCtx, setDraftCtx] = useState<ProductUnitContexts>(() =>
    defaultContexts(baseUnit, null),
  );

  // Re-sync draft when server data arrives or changes (GeneralPanel pattern).
  useEffect(() => {
    if (data === undefined) return;
    setDraftAlts((data.alternatives ?? []).map(toDraft));
    setDraftCtx(defaultContexts(baseUnit, data.contexts));
  }, [data, baseUnit]);

  const isDirty = useMemo(() => {
    if (data === undefined) return false;
    const serverAlts = data.alternatives ?? [];
    const serverCtx  = defaultContexts(baseUnit, data.contexts);
    const currentAlts: ProductUnitAlt[] = draftAlts.map((a, i) => ({
      code:           a.code,
      factor_to_base: a.factor_to_base,
      tags:           a.tags,
      display_order:  i * 10,
    }));
    return !altsEqual(currentAlts, serverAlts) || !contextsEqual(draftCtx, serverCtx);
  }, [data, draftAlts, draftCtx, baseUnit]);

  /** Validate: no empty codes, factor > 0, no duplicate codes among alts. */
  const isValid = useMemo(() => {
    const codes = draftAlts.map((a) => a.code.trim());
    const hasBlanks   = codes.some((c) => c === '');
    const hasBadFactor = draftAlts.some((a) => !(a.factor_to_base > 0));
    const hasDupes    = new Set(codes).size !== codes.length;
    return !hasBlanks && !hasBadFactor && !hasDupes;
  }, [draftAlts]);

  /** The option list for context selects: base unit + active alt codes. */
  const unitOptions = useMemo(
    () => [baseUnit, ...draftAlts.map((a) => a.code.trim()).filter(Boolean)],
    [baseUnit, draftAlts],
  );

  function addAlt(): void {
    setDraftAlts((prev) => [
      ...prev,
      { _key: newKey(), code: '', factor_to_base: 1, tags: [], display_order: prev.length * 10 },
    ]);
  }

  function updateAlt(key: string, field: 'code' | 'factor_to_base', value: string | number): void {
    setDraftAlts((prev) =>
      prev.map((a) => (a._key === key ? { ...a, [field]: value } : a)),
    );
  }

  function removeAlt(key: string): void {
    setDraftAlts((prev) => prev.filter((a) => a._key !== key));
  }

  function updateCtx(field: keyof ProductUnitContexts, value: string): void {
    setDraftCtx((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave(): void {
    if (!isDirty || !isValid) return;
    const alts: ProductUnitAlt[] = draftAlts.map((a, i) => ({
      code:           a.code.trim(),
      factor_to_base: a.factor_to_base,
      tags:           a.tags,
      display_order:  i * 10,
    }));
    setUnits.mutate(
      { alts, contexts: draftCtx },
      {
        onSuccess: () => { toast.success('Units saved.'); },
        onError:   (err) => { toast.error(`Failed to save units: ${err.message}`); },
      },
    );
  }

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-text-secondary">Loading units…</div>;
  }
  if (error !== null && error !== undefined) {
    return (
      <div role="alert" className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red">
        Failed to load units: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Base unit (editable via set_product_base_unit_v1, guarded) ── */}
      <Card padding="md">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gold-soft text-gold">
              <Box className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="font-display text-lg text-text-primary">Base Unit (Stock)</h2>
              <p className="text-xs italic text-text-secondary">All conversions are done relative to this unit</p>
            </div>
          </div>
          <select
            aria-label="Base unit"
            value={baseDraft}
            disabled={!canWrite || setBaseUnit.isPending}
            onChange={(e) => setBaseDraft(e.target.value)}
            data-testid="base-unit-select"
            className="h-touch-min rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {baseUnitOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {/* Deliberate confirm — changing the base unit resets alternative units &
            contexts and is refused by the server when stock/movements exist. */}
        {baseChanged && (
          <div
            data-testid="base-unit-confirm"
            className="mt-4 flex flex-col gap-3 rounded-lg border border-gold/40 bg-gold-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2 text-xs text-text-secondary">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
              <span>
                Changing <span className="font-mono text-text-primary">{baseUnit}</span> →{' '}
                <span className="font-mono text-text-primary">{baseDraft}</span> resets the
                alternative units and context choices. Only allowed when this product has zero
                stock and no stock movements.
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setBaseDraft(baseUnit)}
                disabled={setBaseUnit.isPending}
                className="rounded-full border border-border-subtle px-4 py-2 text-xs font-semibold uppercase tracking-widest text-text-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyBaseUnit}
                disabled={setBaseUnit.isPending}
                data-testid="base-unit-apply"
                className="rounded-full bg-gold px-4 py-2 text-xs font-semibold uppercase tracking-widest text-bg-base disabled:cursor-not-allowed disabled:opacity-50"
              >
                {setBaseUnit.isPending ? 'Changing…' : 'Change base unit'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Alternative units ── */}
      <Card padding="md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg text-text-primary">Alternative Units</h2>
            <p className="text-xs italic text-text-secondary">Define purchase or consumption units</p>
          </div>
          <button
            type="button"
            disabled={!canWrite}
            onClick={addAlt}
            data-testid="add-alt-unit-btn"
            className="inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-xs font-semibold uppercase tracking-widest text-bg-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New Unit
          </button>
        </div>

        {draftAlts.length === 0 ? (
          <p className="text-sm italic text-text-muted" data-testid="no-alt-units">
            No alternative units defined.
          </p>
        ) : (
          <ul className="space-y-2">
            {draftAlts.map((alt) => (
              <li
                key={alt._key}
                data-testid={`alt-unit-row-${alt._key}`}
                className="flex items-center gap-4 rounded-lg border border-border-subtle bg-bg-overlay px-4 py-3"
              >
                {/* Code */}
                <input
                  type="text"
                  aria-label="Unit code"
                  value={alt.code}
                  disabled={!canWrite}
                  onChange={(e) => updateAlt(alt._key, 'code', e.target.value)}
                  placeholder="e.g. kg"
                  className="w-20 rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 font-mono text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                />
                {/* Factor */}
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-xs text-text-secondary">1 unit =</span>
                  <input
                    type="number"
                    aria-label="Factor to base"
                    value={alt.factor_to_base}
                    min={0.000001}
                    step="any"
                    disabled={!canWrite}
                    onChange={(e) => updateAlt(alt._key, 'factor_to_base', Number(e.target.value) || 0)}
                    className="w-28 rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 font-mono text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                  />
                  <span className="text-xs text-text-secondary font-mono">{baseUnit}</span>
                </div>
                {/* Remove */}
                <button
                  type="button"
                  aria-label={`Remove unit ${alt.code || 'row'}`}
                  disabled={!canWrite}
                  onClick={() => removeAlt(alt._key)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:enabled:bg-red-soft hover:enabled:text-red disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Units by context ── */}
      <Card padding="md">
        <div className="mb-4">
          <h2 className="font-display text-lg text-text-primary">Units by Context</h2>
          <p className="text-xs italic text-text-secondary">Choose the unit to use in each application context</p>
        </div>

        <div className="space-y-3">
          <ContextRow
            icon={<ClipboardList className="h-4 w-4" aria-hidden />}
            label="Stock Opname"
            sub="Unit used for inventory counting"
            field="stock_opname_unit"
            value={draftCtx.stock_opname_unit}
            options={unitOptions}
            disabled={!canWrite}
            onChange={(v) => updateCtx('stock_opname_unit', v)}
          />
          <ContextRow
            icon={<BookOpen className="h-4 w-4" aria-hidden />}
            label="Recipe"
            sub="Unit used in BOM definition"
            field="recipe_unit"
            value={draftCtx.recipe_unit}
            options={unitOptions}
            disabled={!canWrite}
            onChange={(v) => updateCtx('recipe_unit', v)}
          />
          <ContextRow
            icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
            label="Purchase"
            sub="Unit used in supplier orders"
            field="purchase_unit"
            value={draftCtx.purchase_unit}
            options={unitOptions}
            disabled={!canWrite}
            onChange={(v) => updateCtx('purchase_unit', v)}
          />
          <ContextRow
            icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
            label="Sales"
            sub="Unit used in POS sales"
            field="sales_unit"
            value={draftCtx.sales_unit}
            options={unitOptions}
            disabled={!canWrite}
            onChange={(v) => updateCtx('sales_unit', v)}
          />
        </div>
      </Card>

      {/* ── Save bar ── */}
      {canWrite && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!isDirty || !isValid || setUnits.isPending}
            onClick={handleSave}
            data-testid="units-save-btn"
            className="rounded-full bg-gold px-6 py-2.5 text-xs font-semibold uppercase tracking-widest text-bg-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            {setUnits.isPending ? 'Saving…' : 'Save Units'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── ContextRow sub-component ──────────────────────────────────────────────────

interface ContextRowProps {
  icon:     JSX.Element;
  label:    string;
  sub:      string;
  field:    keyof ProductUnitContexts;
  value:    string;
  options:  string[];
  disabled: boolean;
  onChange: (v: string) => void;
}

function ContextRow({ icon, label, sub, field, value, options, disabled, onChange }: ContextRowProps): JSX.Element {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-overlay p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-bg-elevated text-gold">
          {icon}
        </div>
        <div>
          <SectionLabel as="div" size="xs">{label}</SectionLabel>
          <div className="text-xs italic text-text-secondary">{sub}</div>
        </div>
      </div>
      <select
        aria-label={`${label} unit`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`context-select-${field}`}
        className="mt-3 h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}{opt === options[0] ? ' (Base unit)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
