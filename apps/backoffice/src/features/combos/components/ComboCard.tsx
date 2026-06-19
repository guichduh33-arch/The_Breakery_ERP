// apps/backoffice/src/features/combos/components/ComboCard.tsx
//
// Session 47 — rewritten for choice-group model.
// Groups by name + option pills + "+N more", struck-through value price,
// min→max bundle range, Save% badge (from domain savingsPct).

import { Box } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { JSX } from 'react';
import { Card, CardContent, Currency } from '@breakery/ui';
import { savingsPct } from '@breakery/domain';
import type { Combo } from '../types.js';

interface Props {
  combo: Combo;
  onEdit?: () => void;
}

export function ComboCard({ combo, onEdit }: Props): JSX.Element {
  const navigate = useNavigate();
  const savings = savingsPct(combo.value_price, combo.retail_price);

  function handleClick() {
    if (onEdit !== undefined) {
      onEdit();
    } else {
      navigate(`/backoffice/products/combos/${combo.id}/edit`);
    }
  }

  return (
    <Card
      variant="default"
      className="overflow-hidden cursor-pointer hover:border-gold/60 transition-colors"
      onClick={handleClick}
      data-testid={`combo-card-${combo.id}`}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-bg-overlay">
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
            <div className="text-xs italic text-text-secondary">No choice groups yet.</div>
          ) : (
            combo.groups.map((g) => (
              <div key={g.id} className="mt-2">
                <div className="text-[11px] uppercase tracking-widest text-text-secondary">
                  {g.name}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.options.slice(0, 3).map((opt) => (
                    <span
                      key={opt.component_product_id}
                      className="inline-flex items-center gap-1 rounded-full border border-gold-soft bg-bg-elevated px-2 py-0.5 text-[11px] text-text-primary"
                    >
                      {opt.label}
                      {opt.surcharge > 0 && (
                        <span className="ml-1 font-mono text-[10px] text-gold">
                          +Rp {opt.surcharge.toLocaleString('id-ID')}
                        </span>
                      )}
                    </span>
                  ))}
                  {g.options.length > 3 && (
                    <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-text-secondary">
                      +{g.options.length - 3} more
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
            {combo.value_price !== null && combo.value_price > 0 ? (
              <div className="text-xs font-mono text-text-muted line-through">
                Rp {Math.round(combo.value_price).toLocaleString('id-ID')}
              </div>
            ) : (
              <div className="text-xs text-text-muted">—</div>
            )}
            <div className="mt-1 text-[10px] uppercase tracking-widest text-text-secondary">
              Bundle Set Price
            </div>
            <div className="font-display text-2xl text-gold">
              {combo.price_min === combo.price_max ? (
                <Currency amount={combo.price_min} emphasis="gold" />
              ) : (
                <span>
                  Rp {combo.price_min.toLocaleString('id-ID')}
                  {' – '}
                  Rp {combo.price_max.toLocaleString('id-ID')}
                </span>
              )}
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
