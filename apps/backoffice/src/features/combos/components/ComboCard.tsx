// apps/backoffice/src/features/combos/components/ComboCard.tsx
//
// Session 47 — rewritten for choice-group model.
// Groups by name + option pills + "+N more", struck-through value price,
// min→max bundle range, Save% badge (from domain savingsPct).

import { Box } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { JSX } from 'react';
import { Card, CardContent, Currency } from '@breakery/ui';
import { savingsPct } from '@breakery/domain';
import type { Combo } from '../types.js';
import { formatCurrency } from '@breakery/utils';

interface Props {
  combo: Combo;
  onEdit?: () => void;
}

// The whole card is a mouse target, but the *keyboard* target is the title
// alone: a <button> wrapping the card would put flow content (h3, img) inside
// phrasing-only content. The stretched pseudo-element keeps the click surface
// without lying about the DOM, and the combo name becomes the accessible name.
const TITLE_LINK =
  "text-left after:absolute after:inset-0 after:content-[''] hover:text-gold focus-visible:outline-none";

// The focus ring lives on the card, not on the title text, so the whole object
// is shown as the target.
const CARD =
  'relative overflow-hidden transition-colors hover:border-gold ' +
  'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold';

export function ComboCard({ combo, onEdit }: Props): JSX.Element {
  const savings = savingsPct(combo.value_price, combo.retail_price);

  return (
    <Card
      variant="default"
      className={CARD}
      data-testid={`combo-card-${combo.id}`}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-bg-overlay">
        {combo.image_url === null ? (
          <div className="flex h-full w-full items-center justify-center text-text-muted">
            <Box className="h-10 w-10" aria-hidden />
          </div>
        ) : (
          <img src={combo.image_url} alt={combo.name} loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>

      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-2">
          {/* h2 et non h3 : la page n'a que son h1, le saut de niveau cassait
              la structure de titres (WCAG 1.3.1). */}
          <h2 className="text-xl font-semibold text-text-primary">
            {onEdit === undefined ? (
              <Link to={`/backoffice/products/combos/${combo.id}/edit`} className={TITLE_LINK}>
                {combo.name}
              </Link>
            ) : (
              <button type="button" onClick={onEdit} className={TITLE_LINK}>
                {combo.name}
              </button>
            )}
          </h2>
          <span
            className={
              combo.is_active
                ? 'rounded-full border border-border-subtle px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-widest text-text-primary'
                : 'rounded-full border border-red-soft px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-widest text-red'
            }
          >
            {combo.is_active ? 'POS Visible' : 'Hidden'}
          </span>
        </div>

        <div className="rounded-lg border border-border-subtle bg-bg-overlay p-3">
          <div className="mb-2 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-widest text-gold">
            <Box className="h-3 w-3" aria-hidden />
            Selections
          </div>

          {combo.groups.length === 0 ? (
            <div className="text-xs italic text-text-secondary">No choice groups yet.</div>
          ) : (
            combo.groups.map((g) => (
              <div key={g.id} className="mt-2">
                <div className="text-[0.6875rem] uppercase tracking-widest text-text-secondary">
                  {g.name}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.options.slice(0, 3).map((opt) => (
                    <span
                      key={opt.component_product_id}
                      className="inline-flex items-center gap-1 rounded-full border border-gold-soft bg-bg-elevated px-2 py-0.5 text-[0.6875rem] text-text-primary"
                    >
                      {opt.label}
                      {opt.surcharge > 0 && (
                        <span className="ml-1 text-[0.625rem] text-gold">
                          +<Currency format={formatCurrency} amount={opt.surcharge} />
                        </span>
                      )}
                    </span>
                  ))}
                  {g.options.length > 3 && (
                    <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[0.6875rem] text-text-secondary">
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
            <div className="text-xs uppercase tracking-widest text-text-secondary">Value Price</div>
            {combo.value_price !== null && combo.value_price > 0 ? (
              <Currency format={formatCurrency}
                amount={Math.round(combo.value_price)}
                className="block text-xs text-text-muted line-through"
              />
            ) : (
              <div className="text-xs text-text-muted">—</div>
            )}
            <div className="mt-1 text-xs uppercase tracking-widest text-text-secondary">
              Bundle Set Price
            </div>
            {/* Les deux branches passent par <Currency> : une carte a deja
                affiche les deux separateurs de milliers pour la meme devise
                (audit du 2026-08-11). Le formateur du back-office est
                `formatCurrency` (id-ID, « Rp 100.000 ») depuis l'audit UX/UI
                du 2026-08-13 ; il est passe en prop pour que le POS garde le
                sien. */}
            <div className="text-2xl text-gold">
              {combo.price_min === combo.price_max ? (
                <Currency format={formatCurrency} amount={combo.price_min} emphasis="gold" />
              ) : (
                <span className="font-mono tabular-nums">
                  <Currency format={formatCurrency} amount={combo.price_min} emphasis="gold" />
                  {' – '}
                  <Currency format={formatCurrency} amount={combo.price_max} emphasis="gold" />
                </span>
              )}
            </div>
          </div>
          {savings !== null && savings > 0 && (
            <span className="inline-flex flex-col items-center justify-center rounded-full bg-gold-soft px-3 py-2 text-gold">
              <span className="text-[0.5625rem] font-semibold uppercase tracking-widest">Save</span>
              <span className="font-mono text-sm font-bold tabular-nums">{savings}%</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
