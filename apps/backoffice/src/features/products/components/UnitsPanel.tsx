// apps/backoffice/src/features/products/components/UnitsPanel.tsx
//
// Session 14 / Phase 4.B — Units tab on product detail page.
// Mirrors `product unit.jpg` and `productunit2.jpg`:
//   - Base unit selector card
//   - Alternative units list (purchase / recipe / sales tags)
//   - Units by Context (stock opname, recipe, purchase, sales)
//
// Read-only for v1 — alt units + context mapping are not yet persisted via
// RPC. The UI is wired so a future patch only needs to attach mutations.

import { Box, BookOpen, ClipboardList, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import { Card, SectionLabel } from '@breakery/ui';
import type { ProductRow } from '../types.js';

interface Props {
  product: ProductRow;
}

interface AlternativeUnit {
  id:           string;
  code:         string;
  factor:       number;
  factor_label: string;
  tags:         ReadonlyArray<'purchase' | 'recipe' | 'sales'>;
}

const SAMPLE_ALT_UNITS: ReadonlyArray<AlternativeUnit> = [
  { id: 'g',  code: 'g',  factor: 0.001, factor_label: '1 g = 0.001 kg', tags: ['purchase'] },
  { id: 'kg', code: 'kg', factor: 1,     factor_label: '1 kg = 1 kg',    tags: [] },
  { id: 'gr', code: 'gr', factor: 0.001, factor_label: '1 gr = 0.001 kg', tags: ['recipe', 'purchase'] },
];

export function UnitsPanel({ product }: Props): JSX.Element {
  return (
    <div className="space-y-6">
      <Card padding="md" className="flex items-center justify-between gap-4">
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
          defaultValue={product.unit}
          disabled
          className="h-touch-min rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono text-text-primary disabled:opacity-50"
        >
          <option value={product.unit}>{product.unit}</option>
        </select>
      </Card>

      <Card padding="md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg text-text-primary">Alternative Units</h2>
            <p className="text-xs italic text-text-secondary">Define purchase or consumption units</p>
          </div>
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-xs font-semibold uppercase tracking-widest text-bg-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New Unit
          </button>
        </div>

        <ul className="space-y-2">
          {SAMPLE_ALT_UNITS.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-4 rounded-lg border border-border-subtle bg-bg-overlay px-4 py-3"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-bg-elevated text-xs font-bold uppercase tracking-widest text-text-secondary">
                {u.code.toUpperCase()}
              </span>
              <div className="flex-1">
                <div className="font-mono text-sm text-text-primary">{u.code}</div>
                <div className="text-xs text-text-secondary">{u.factor_label}</div>
              </div>
              <div className="flex items-center gap-2">
                {u.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-gold-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-gold"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <button
                type="button"
                aria-label={`Remove ${u.code}`}
                disabled
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-red-soft hover:text-red disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Card>

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
            unit={product.unit}
          />
          <ContextRow
            icon={<BookOpen className="h-4 w-4" aria-hidden />}
            label="Recipe"
            sub="Unit used in BOM definition"
            unit={product.unit}
          />
          <ContextRow
            icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
            label="Purchase"
            sub="Unit used in supplier orders"
            unit={product.unit}
          />
        </div>
      </Card>
    </div>
  );
}

interface ContextRowProps {
  icon: JSX.Element;
  label: string;
  sub: string;
  unit: string;
}

function ContextRow({ icon, label, sub, unit }: ContextRowProps): JSX.Element {
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
        defaultValue={unit}
        disabled
        className="mt-3 h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono text-text-primary disabled:opacity-50"
      >
        <option value={unit}>{unit} (Base unit)</option>
      </select>
    </div>
  );
}
