// apps/backoffice/src/features/products/components/GeneralPanel.tsx
//
// Session 14 / Phase 4.B — General tab on the product detail page.
// Mirrors `product general 1.jpg`, `product general 2.jpg`, `product
// general 3.jpg`. Three column layout collapsing to one on small screens:
//   - Left:  Product Identity (name, sku, category, description), Visual Asset
//   - Right: Performance(30D), Finance & POS, Inventory levels, Usage Sections
//
// Read-only for v1 — write paths gated on a future product CRUD RPC. Inputs
// are kept editable visually so the form layout review is meaningful, but
// the Save action is disabled at the page level.

import { ShoppingCart, Sparkles, TrendingUp } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';
import { Card, Currency, Input, SectionLabel, Select } from '@breakery/ui';
import type { CategoryOption, ProductRow } from '../types.js';
import { ProductImageUploader } from './ProductImageUploader.js';

interface Props {
  product: ProductRow;
  categories: readonly CategoryOption[];
  /** When set, edits are disabled (e.g. user lacks `products.update`). */
  readOnly?: boolean;
  /** Called when any field changes. */
  onChange?: (patch: Partial<ProductRow>) => void;
  /**
   * Vitrine counter for this product (display_stock). `null` = no row / not
   * stocked yet, `undefined` = not provided. Drives the M7 "needs stocking"
   * banner: a display-case item with a 0/empty counter is unsellable at the POS.
   */
  displayStockQty?: number | null;
}

export function GeneralPanel({ product, categories, readOnly = true, onChange, displayStockQty }: Props): JSX.Element {
  const [draft, setDraft] = useState<ProductRow>(product);

  // Re-sync draft when the saved product changes (post-mutation refetch).
  useEffect(() => {
    setDraft(product);
  }, [product]);

  function update<K extends keyof ProductRow>(key: K, value: ProductRow[K]): void {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onChange?.({ [key]: value });
  }

  // Spec B-1 Ph2 — toggle a dispatch station in the per-product override array.
  // Empty array collapses to null (inherit from category); non-empty is persisted as-is.
  function toggleStation(station: 'kitchen' | 'barista' | 'display'): void {
    const current = [...(draft.dispatch_stations ?? [])];
    const next = current.includes(station)
      ? current.filter((s) => s !== station)
      : [...current, station];
    update('dispatch_stations', next.length > 0 ? next : null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* ───────────── Left column (2/3) ───────────── */}
      <div className="space-y-6 lg:col-span-2">
        <Card padding="md">
          <h2 className="mb-4 font-display text-xl text-text-primary">Product Identity</h2>

          <div className="space-y-4">
            <div>
              <SectionLabel as="div" size="xs">Product name</SectionLabel>
              <Input
                value={draft.name}
                disabled={readOnly}
                onChange={(e) => update('name', e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <SectionLabel as="div" size="xs">SKU code</SectionLabel>
                <Input
                  value={draft.sku}
                  disabled={readOnly}
                  onChange={(e) => update('sku', e.target.value)}
                  className="mt-1.5 font-mono"
                />
              </div>
              <div>
                <SectionLabel as="div" size="xs">Category</SectionLabel>
                <Select
                  value={draft.category_id}
                  disabled={readOnly}
                  onChange={(e) => update('category_id', e.target.value)}
                  className="mt-1.5"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <SectionLabel as="div" size="xs">Product description</SectionLabel>
              <textarea
                rows={4}
                value={draft.description ?? ''}
                disabled={readOnly}
                onChange={(e) => update('description', e.target.value as ProductRow['description'])}
                placeholder="Add a short description..."
                className="mt-1.5 block w-full resize-y rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl text-text-primary">Visual Asset</h2>
            <span className="rounded-full border border-gold-soft px-3 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-gold">
              High Resolution
            </span>
          </div>
          <ProductImageUploader
            productId={draft.id}
            imageUrl={draft.image_url}
            readOnly={readOnly}
            onChange={(url) => update('image_url', url)}
          />
        </Card>

        <Card padding="md">
          <h2 className="mb-4 font-display text-xl text-text-primary">Usage Sections</h2>
          <p className="mb-4 text-xs uppercase tracking-widest text-text-secondary">
            Departmental availability & routing
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {SAMPLE_SECTIONS.map((s) => (
              <div
                key={s.label}
                className={`rounded-lg border ${s.highlighted ? 'border-gold bg-gold-soft' : 'border-border-subtle bg-bg-elevated'} px-3 py-4 text-center`}
              >
                <div className="text-[10px] uppercase tracking-widest text-text-secondary">{s.label}</div>
                <div className="mt-1 text-[10px] uppercase tracking-widest text-text-muted">{s.kind}</div>
                {s.highlighted && (
                  <div className="mt-2 text-[9px] font-semibold uppercase tracking-widest text-gold">
                    Primary route
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ───────────── Right column ───────────── */}
      <div className="space-y-6">
        <Card padding="md">
          <h2 className="mb-4 font-display text-xl text-text-primary">Performance (30d)</h2>
          <div className="space-y-4">
            <SidebarMetric icon={<TrendingUp className="h-4 w-4" aria-hidden />} label="Conversion" value="0%" mono />
            <SidebarMetric icon={<ShoppingCart className="h-4 w-4" aria-hidden />} label="Units sold" value="0" mono />
            <SidebarMetric icon={<Sparkles className="h-4 w-4" aria-hidden />} label="Revenue" value="—" />
          </div>
        </Card>

        <Card padding="md">
          <h2 className="mb-4 font-display text-xl text-text-primary">Finance & POS</h2>
          <div className="space-y-4">
            <div>
              <SectionLabel as="div" size="xs">Retail price (IDR)</SectionLabel>
              <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm">
                <span className="text-gold">Rp</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={draft.retail_price}
                  disabled={readOnly}
                  onChange={(e) => update('retail_price', Number(e.target.value) || 0)}
                  className="w-full bg-transparent text-text-primary outline-none disabled:cursor-not-allowed"
                />
              </div>
            </div>
            <div>
              <SectionLabel as="div" size="xs">Recipe cost / {draft.unit}</SectionLabel>
              <div className="mt-1.5 rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono">
                {draft.cost_price > 0
                  ? <Currency amount={draft.cost_price} emphasis="gold" />
                  : <span className="text-text-muted">—</span>}
              </div>
            </div>

            <ToggleRow
              label="Visible on POS"
              sub="Active in sales menu"
              enabled={draft.visible_on_pos}
              disabled={readOnly}
              onChange={(v) => update('visible_on_pos', v)}
            />
            <ToggleRow
              label="Deduct stock"
              sub="Déduit les matières premières de la recette (à la production si suivi, à la vente sinon)"
              enabled={draft.deduct_stock}
              disabled={readOnly}
              onChange={(v) => update('deduct_stock', v)}
            />
            <ToggleRow
              label="Active"
              sub="Product selling status"
              enabled={draft.is_active}
              disabled={readOnly}
              onChange={(v) => update('is_active', v)}
            />
            <ToggleRow
              label="Available for sale"
              sub="Shown in POS menu"
              enabled={draft.available_for_sale}
              disabled={readOnly}
              onChange={(v) => update('available_for_sale', v)}
            />
            <ToggleRow
              label="Track inventory"
              sub="Suit le stock du produit lui-même (décrémenté à la vente, monté à la production)"
              enabled={draft.track_inventory}
              disabled={readOnly}
              onChange={(v) => update('track_inventory', v)}
            />
            <ToggleRow
              label="Display-case item (POS vitrine)"
              sub="Stock vitrine séparé ; la vente garde sur le compteur vitrine, pas l'inventaire global."
              enabled={draft.is_display_item ?? false}
              disabled={readOnly}
              onChange={(v) => update('is_display_item', v)}
            />
            {draft.is_display_item === true && (displayStockQty ?? 0) <= 0 && (
              <div
                role="alert"
                data-testid="display-stock-warning"
                className="rounded-md border border-gold-soft bg-gold/5 px-3 py-2 text-xs text-text-secondary"
              >
                <span className="font-semibold text-gold">
                  Compteur vitrine à {displayStockQty ?? 0}.
                </span>{' '}
                Ce produit ne sera pas vendable au POS tant que la vitrine n'est pas
                approvisionnée (geste POS «&nbsp;Mettre en vitrine&nbsp;»). Le BackOffice
                ne gère pas le stock vitrine.
              </div>
            )}
          </div>
        </Card>

        {/* Spec B-1 Ph2 — override multi-station de dispatch par produit. */}
        <Card padding="md">
          <h2 className="mb-1 font-display text-xl text-text-primary">Dispatch Routing</h2>
          <p className="mb-3 text-[11px] italic text-text-secondary">
            Stations qui reçoivent le KOT pour ce produit. Vide = hériter de la catégorie.
          </p>
          <div className="space-y-2" data-testid="dispatch-stations-picker">
            {(['kitchen', 'barista', 'display'] as const).map((station) => {
              const checked = (draft.dispatch_stations ?? []).includes(station);
              return (
                <label
                  key={station}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                >
                  <input
                    type="checkbox"
                    data-testid={`dispatch-station-${station}`}
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => toggleStation(station)}
                    className="h-4 w-4 accent-gold disabled:cursor-not-allowed"
                  />
                  <span className="text-xs font-semibold uppercase tracking-widest text-text-primary">
                    {station}
                  </span>
                </label>
              );
            })}
          </div>
          {(draft.dispatch_stations === null || draft.dispatch_stations.length === 0) && (
            <p
              data-testid="dispatch-inherit-label"
              className="mt-2 text-[11px] italic text-text-muted"
            >
              Hérite le dispatch de la catégorie.
            </p>
          )}
        </Card>

        <Card padding="md">
          <SectionLabel as="h3" size="xs">Inventory levels</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">Current stock</div>
              <Input
                value={draft.current_stock}
                disabled
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-text-secondary">Alert threshold</div>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={draft.min_stock_threshold}
                disabled={readOnly}
                onChange={(e) => update('min_stock_threshold', Math.max(0, Number(e.target.value) || 0))}
                className="mt-1.5 font-mono"
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Sous ce seuil le produit remonte dans Alerts / reorder suggestions. 0 = jamais.
          </p>
        </Card>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label:     string;
  sub:       string;
  enabled:   boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}

function ToggleRow({ label, sub, enabled, disabled = false, onChange }: ToggleRowProps): JSX.Element {
  const interactive = !disabled && onChange !== undefined;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={!interactive}
      onClick={() => onChange?.(!enabled)}
      className="flex w-full items-center justify-between rounded-md border border-border-subtle bg-bg-overlay px-3 py-2.5 text-left transition-colors hover:enabled:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-primary">{label}</div>
        <div className="text-[11px] italic text-text-secondary">{sub}</div>
      </div>
      <span
        aria-hidden
        className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-gold' : 'bg-bg-input'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-bg-elevated transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

interface SidebarMetricProps {
  icon: JSX.Element;
  label: string;
  value: string;
  mono?: boolean;
}

function SidebarMetric({ icon, label, value, mono = false }: SidebarMetricProps): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-soft text-gold">{icon}</div>
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-widest text-text-secondary">{label}</div>
        <div className={mono ? 'font-mono text-2xl tabular-nums text-text-primary' : 'text-2xl text-text-primary'}>
          {value}
        </div>
      </div>
    </div>
  );
}

const SAMPLE_SECTIONS: readonly { label: string; kind: string; highlighted: boolean }[] = [
  { label: 'Main Warehouse', kind: 'Warehouse',  highlighted: false },
  { label: 'Pastry',         kind: 'Production', highlighted: false },
  { label: 'Cafe',           kind: 'Sales',      highlighted: false },
  { label: 'Hot Kitchen',    kind: 'Production', highlighted: true  },
  { label: 'Viennoiserie',   kind: 'Production', highlighted: false },
  { label: 'Bakery',         kind: 'Production', highlighted: false },
];

