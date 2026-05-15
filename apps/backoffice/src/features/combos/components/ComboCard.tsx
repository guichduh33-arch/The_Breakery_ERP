// apps/backoffice/src/features/combos/components/ComboCard.tsx
//
// Session 14 / Phase 4.B — Single combo tile shown on the management grid.
// Mirrors `combo management.jpg`: header (image), name + POS-visible badge,
// "SELECTIONS" section listing components grouped by category as pill chips,
// and a footer with Bundle Set Price (gold) + struck-through Value Price +
// optional savings badge.

import { Box, GripVertical } from 'lucide-react';
import type { JSX } from 'react';
import { Card, CardContent, Currency } from '@breakery/ui';
import { comboSavingsPct, type Combo } from '../types.js';

interface Props {
  combo: Combo;
}

export function ComboCard({ combo }: Props): JSX.Element {
  const savings = comboSavingsPct(combo);
  return (
    <Card variant="default" className="overflow-hidden">
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-bg-overlay">
        <button
          type="button"
          aria-label={`Reorder ${combo.name}`}
          className="absolute left-3 top-3 inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-full bg-bg-elevated/80 text-text-secondary backdrop-blur transition hover:bg-bg-elevated"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        {combo.image_url === null ? (
          <div className="flex h-full w-full items-center justify-center text-text-muted">
            <Box className="h-10 w-10" aria-hidden />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={combo.image_url} alt={combo.name} className="h-full w-full object-cover" />
        )}
      </div>

      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-xl text-text-primary">{combo.name}</h3>
          <span
            className={
              combo.is_active
                ? 'rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-text-primary'
                : 'rounded-full border border-red-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-red'
            }
          >
            {combo.is_active ? 'POS Visible' : 'Hidden'}
          </span>
        </div>

        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-gold">
            <Box className="h-3 w-3" aria-hidden />
            Selections
          </div>

          {combo.groups.length === 0 ? (
            <div className="text-xs italic text-text-secondary">No components yet.</div>
          ) : (
            combo.groups.map((g) => (
              <div key={g.category_name} className="mt-2">
                <div className="text-[11px] uppercase tracking-widest text-text-secondary">
                  {g.category_name}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.components.slice(0, 3).map((c) => (
                    <span
                      key={c.product_id}
                      className="inline-flex items-center gap-1 rounded-full border border-gold-soft bg-bg-elevated px-2 py-0.5 text-[11px] text-text-primary"
                    >
                      {c.product_name}
                      {c.upcharge > 0 && (
                        <span className="ml-1 font-mono text-[10px] text-gold">
                          +Rp {c.upcharge.toLocaleString()}
                        </span>
                      )}
                    </span>
                  ))}
                  {g.components.length > 3 && (
                    <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-text-secondary">
                      +{g.components.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-end justify-between gap-2 pt-1">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-text-secondary">Value Price</div>
            {combo.base_price > 0 ? (
              <div className="text-xs font-mono text-text-muted line-through">
                Rp {Math.round(combo.base_price).toLocaleString()}
              </div>
            ) : (
              <div className="text-xs text-text-muted">—</div>
            )}
            <div className="mt-1 text-[10px] uppercase tracking-widest text-text-secondary">Bundle Set Price</div>
            <div className="font-display text-2xl text-gold">
              <Currency amount={combo.retail_price} emphasis="gold" />
            </div>
          </div>
          {savings !== null && savings > 0 && (
            <span className="inline-flex flex-col items-center justify-center rounded-full bg-gold-soft px-3 py-2 text-gold">
              <span className="text-[9px] font-semibold uppercase tracking-widest">Save</span>
              <span className="font-mono text-sm font-bold tabular-nums">{savings}%</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
