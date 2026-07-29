// apps/backoffice/src/features/inventory-production/components/ProductionEntryCard.tsx
//
// Left card of the redesigned Production page. Multi-row production entry for a
// single station (section). Each row = a producible product (strictly filtered
// to the station via product_sections) + quantity in a chosen unit + waste +
// note. Submit is atomic via record_batch_production_v5 — any insufficient
// stock rolls the whole batch back.
//
// Logic kept from the legacy form: required section, idempotency key, atomic
// rollback, insufficient-stock surfacing. The entry's date/time may be
// backdated (production_date only — the ledger/JEs stay at now()).
//
// Per-row notes are persisted at batch level (the RPC has no per-item note
// field): non-empty notes are combined into the batch notes as "Product: note".
//
// ADR-008 D4 — un stock insuffisant BLOQUE le lot. L'échappatoire (forçage) ne
// s'affiche qu'après un refus, et seulement pour un utilisateur porteur de
// `inventory.production.force_negative` : forcer reste un acte volontaire et
// tracé, jamais un réglage laissé coché par défaut.

import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Card, SectionLabel } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useProducibleProductsBySection,
  type ProducibleProduct,
} from '../hooks/useProducibleProductsBySection.js';
import {
  useRecordBatchProduction,
  RecordBatchProductionError,
  type BatchItemInput,
} from '../hooks/useRecordBatchProduction.js';

interface Props {
  sectionId: string;
  sectionName: string;
  /** Day the page is viewing — the entry date/time defaults to it (backdating). */
  selectedDate: Date;
}

interface EntryRow {
  rowId: string;
  product: ProducibleProduct;
  unitCode: string;
  quantity: string;
  waste: string;
  note: string;
}

/** Format a Date as a `datetime-local` value in local time: YYYY-MM-DDTHH:mm. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function ProductionEntryCard({ sectionId, sectionName, selectedDate }: Props): JSX.Element {
  const products = useProducibleProductsBySection(sectionId);
  const recordMut = useRecordBatchProduction();
  const canForceNegative = useAuthStore((s) => s.hasPermission)('inventory.production.force_negative');

  const [rows, setRows] = useState<EntryRow[]>([]);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [productionAt, setProductionAt] = useState<string>(() => toDatetimeLocal(selectedDate));
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [shortages, setShortages] = useState<{ material_name: string; shortfall: number; unit: string }[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [forceNegative, setForceNegative] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the viewed day changes, re-seed the entry date/time to that day (keep
  // the current clock time so "today" stays now-ish).
  useEffect(() => {
    const now = new Date();
    const seeded = new Date(selectedDate);
    seeded.setHours(now.getHours(), now.getMinutes(), 0, 0);
    setProductionAt(toDatetimeLocal(seeded));
  }, [selectedDate]);

  // Reset rows when switching station — a row's product belongs to one station.
  useEffect(() => {
    setRows([]);
    setQuery('');
    setShortages(null);
    setFormError(null);
    setForceNegative(false);
  }, [sectionId]);

  const chosenIds = useMemo(() => new Set(rows.map((r) => r.product.id)), [rows]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return (products.data ?? [])
      .filter((p) => !chosenIds.has(p.id))
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, products.data, chosenIds]);

  function addProduct(p: ProducibleProduct): void {
    setRows((prev) => [
      ...prev,
      { rowId: crypto.randomUUID(), product: p, unitCode: p.unit, quantity: '1', waste: '0', note: '' },
    ]);
    setQuery('');
    setSearchFocused(false);
  }

  function updateRow(rowId: string, patch: Partial<EntryRow>): void {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  function removeRow(rowId: string): void {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function reset(): void {
    setRows([]);
    setQuery('');
    setShortages(null);
    setFormError(null);
    setForceNegative(false);
  }

  /** Build the RPC items (quantities converted to the product base unit). */
  const items: BatchItemInput[] = useMemo(() => {
    return rows
      .map((r): BatchItemInput | null => {
        const qty = Number.parseFloat(r.quantity);
        const factor = r.product.units.find((u) => u.code === r.unitCode)?.factor_to_base ?? 1;
        if (!Number.isFinite(qty) || qty <= 0) return null;
        const wasteBase = Number.parseFloat(r.waste);
        const out: BatchItemInput = {
          productId: r.product.id,
          quantityProduced: qty * factor,
        };
        if (Number.isFinite(wasteBase) && wasteBase > 0) out.quantityWaste = wasteBase;
        return out;
      })
      .filter((x): x is BatchItemInput => x !== null);
  }, [rows]);

  const canSubmit = items.length > 0 && !recordMut.isPending;

  function handleSubmit(): void {
    if (!canSubmit) return;
    setFormError(null);
    // Les pénuries affichées restent visibles tant que le forçage est armé :
    // l'utilisateur doit voir ce qu'il s'apprête à passer en négatif.
    if (!forceNegative) setShortages(null);

    const combinedNotes = rows
      .filter((r) => r.note.trim() !== '')
      .map((r) => `${r.product.name}: ${r.note.trim()}`)
      .join(' | ');

    const args: Parameters<typeof recordMut.mutate>[0] = {
      sectionId,
      idempotencyKey,
      items,
      productionDate: new Date(productionAt).toISOString(),
    };
    if (combinedNotes !== '') args.notes = combinedNotes;
    if (forceNegative) args.forceNegative = true;

    recordMut.mutate(args, {
      onSuccess: (res) => {
        if (res.forced_negative === true) {
          toast.warning(`Recorded ${res.batch_number} — forced below stock (traced in the audit log).`);
        } else {
          toast.success(`Recorded ${res.batch_number} (${res.production_records.length} item(s)).`);
        }
        reset();
        setIdempotencyKey(crypto.randomUUID());
      },
      onError: (err) => {
        if (err instanceof RecordBatchProductionError) {
          if (err.code === 'insufficient_stock' && Array.isArray(err.missingDetail)) {
            setShortages(err.missingDetail as { material_name: string; shortfall: number; unit: string }[]);
            setFormError('Insufficient stock for one or more ingredients.');
          } else if (err.code === 'force_negative_forbidden') {
            setForceNegative(false);
            setFormError('You are not allowed to force a production below stock.');
          } else if (err.code === 'invalid_production_date') {
            setFormError('Invalid production date/time.');
          } else if (err.code === 'recipe_not_found') {
            setFormError('A selected product has no active recipe.');
          } else {
            setFormError(`Error: ${err.code}`);
          }
        } else {
          setFormError('Failed to record production.');
        }
      },
    });
  }

  return (
    <Card padding="md" className="space-y-5">
      {/* Header + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-text-primary">
          Production Entry <span className="text-base font-normal text-text-muted">— {sectionName}</span>
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { setSearchFocused(true); if (blurTimer.current) clearTimeout(blurTimer.current); }}
            onBlur={() => { blurTimer.current = setTimeout(() => setSearchFocused(false), 150); }}
            placeholder="Search for a product…"
            aria-label="Search for a product"
            data-testid="production-search"
            className="h-9 w-72 rounded-full border border-border-subtle bg-bg-input pl-9 pr-3 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          />
          {searchFocused && query.trim() !== '' && (
            <ul
              className="absolute right-0 z-20 mt-1 max-h-72 w-80 overflow-auto rounded-lg border border-border-subtle bg-bg-elevated py-1 shadow-lg"
              data-testid="production-search-results"
            >
              {products.isLoading ? (
                <li className="px-3 py-2 text-sm text-text-muted">Loading…</li>
              ) : matches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-text-muted">No products for this station.</li>
              ) : (
                matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); addProduct(p); }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-bg-overlay"
                    >
                      <span className="text-text-primary">{p.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">{p.sku}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Alerts */}
      {formError !== null && (
        <div role="alert" className="rounded-md border border-red bg-red-soft p-3 text-xs text-red">
          {formError}
          {shortages !== null && (
            <ul className="mt-1 list-disc pl-5" data-testid="production-shortages">
              {shortages.map((s, i) => (
                <li key={i}>{s.material_name} short {s.shortfall} {s.unit}</li>
              ))}
            </ul>
          )}
          {shortages !== null && canForceNegative && (
            <label className="mt-3 flex items-start gap-2 border-t border-red/30 pt-2 text-text-secondary">
              <input
                type="checkbox"
                checked={forceNegative}
                onChange={(e) => setForceNegative(e.target.checked)}
                data-testid="force-negative-toggle"
                className="mt-0.5"
              />
              <span>
                <span className="inline-flex items-center gap-1 font-semibold text-red">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Force this production below stock
                </span>
                <span className="block">
                  Raw material stock will go negative and the override is recorded in
                  the audit log. Submit again to confirm.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated">
            <tr className="text-left">
              <th className="px-4 py-2"><SectionLabel as="span" size="xs">Product</SectionLabel></th>
              <th className="px-4 py-2"><SectionLabel as="span" size="xs">Quantity</SectionLabel></th>
              <th className="px-4 py-2"><SectionLabel as="span" size="xs">Waste</SectionLabel></th>
              <th className="px-4 py-2"><SectionLabel as="span" size="xs">Note</SectionLabel></th>
              <th className="px-4 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm italic text-text-muted">
                  Search and add a product to start a production batch.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.rowId} className="border-t border-border-subtle" data-testid={`entry-row-${r.product.sku}`}>
                  <td className="px-4 py-3">
                    <div className="text-text-primary">{r.product.name}</div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-text-muted">{r.product.sku}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0.001}
                        step="0.001"
                        value={r.quantity}
                        onChange={(e) => updateRow(r.rowId, { quantity: e.target.value })}
                        aria-label={`Quantity for ${r.product.name}`}
                        className="w-20 rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                      />
                      <select
                        value={r.unitCode}
                        onChange={(e) => updateRow(r.rowId, { unitCode: e.target.value })}
                        aria-label={`Unit for ${r.product.name}`}
                        className="h-9 rounded-md border border-border-subtle bg-bg-input px-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                      >
                        {r.product.units.map((u) => (
                          <option key={u.code} value={u.code}>{u.code}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.001"
                        value={r.waste}
                        onChange={(e) => updateRow(r.rowId, { waste: e.target.value })}
                        aria-label={`Waste for ${r.product.name}`}
                        className="w-20 rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                      />
                      <span className="text-xs text-text-muted">{r.product.unit}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={r.note}
                      onChange={(e) => updateRow(r.rowId, { note: e.target.value })}
                      maxLength={200}
                      aria-label={`Note for ${r.product.name}`}
                      className="w-full rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.rowId)}
                      aria-label={`Remove ${r.product.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-red-soft hover:text-red"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: production date/time + actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <SectionLabel as="div" size="xs">Production date &amp; time</SectionLabel>
          <input
            type="datetime-local"
            value={productionAt}
            onChange={(e) => setProductionAt(e.target.value)}
            aria-label="Production date and time"
            data-testid="production-datetime"
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            disabled={rows.length === 0 || recordMut.isPending}
            className="rounded-full border border-border-subtle px-5 py-2 text-xs font-semibold uppercase tracking-widest text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="submit-production"
            className="inline-flex items-center gap-2 rounded-full bg-gold px-6 py-2.5 text-xs font-semibold uppercase tracking-widest text-bg-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {recordMut.isPending
              ? 'Submitting…'
              : forceNegative ? 'Force & Submit' : 'Submit Production'}
          </button>
        </div>
      </div>
    </Card>
  );
}
