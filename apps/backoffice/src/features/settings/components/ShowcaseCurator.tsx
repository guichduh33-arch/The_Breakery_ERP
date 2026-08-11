// apps/backoffice/src/features/settings/components/ShowcaseCurator.tsx
//
// ADR-023 déc. 1 et 2 — l'écran de curation de la vitrine de l'écran client.
//
// Ce qu'on édite ici est une LISTE ORDONNÉE D'IDS, rien d'autre. Le prix et la
// photo affichés viennent du catalogue et ne sont pas recopiés : ils sont là
// pour reconnaître le produit, pas pour être enregistrés.
//
// La liste EST l'aperçu : elle est découpée en pages de trois, comme l'écran
// client les fait défiler. On voit donc qui passe avec qui, et dans quel ordre.
//
// L'ordre se change au clavier comme à la souris (monter / descendre) : douze
// entrées au maximum ne justifient pas un glisser-déposer, qui coûterait une
// dépendance et un parcours clavier à réinventer.

import { useMemo, useState, type JSX } from 'react';
import { Currency } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import { TOOLBAR_BTN_SECONDARY } from '@/components/toolbarButton.js';
import { useShowcaseCandidates } from '../hooks/useShowcaseCandidates.js';
import { ShowcaseProductPicker } from './ShowcaseProductPicker.js';

/** Trois par page — la présentation de l'écran client. */
export const SHOWCASE_PAGE_SIZE = 3;
/** Plafond, miroir du CHECK en base et de la validation de set_setting. */
export const SHOWCASE_MAX = 12;

interface Props {
  /** Ids retenus, dans l'ordre d'affichage. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

const ROW_BTN = `h-7 w-7 inline-flex items-center justify-center rounded-sm border border-border-strong bg-bg-elevated text-text-secondary hover:bg-surface-4 disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING}`;

export function ShowcaseCurator({ value, onChange, disabled = false }: Props): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: candidates } = useShowcaseCandidates();

  const byId = useMemo(
    () => new Map((candidates ?? []).map((p) => [p.id, p])),
    [candidates],
  );

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [row] = next.splice(index, 1);
    if (row === undefined) return;
    next.splice(target, 0, row);
    onChange(next);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  const full = value.length >= SHOWCASE_MAX;
  const pageCount = Math.max(1, Math.ceil(value.length / SHOWCASE_PAGE_SIZE));

  return (
    <div className="space-y-3" data-testid="showcase-curator">
      {value.length === 0 ? (
        <p className="text-sm text-text-secondary" data-testid="showcase-empty">
          No product selected. The customer display shows the brand alone, on the full screen.
        </p>
      ) : (
        <ol className="space-y-3" data-testid="showcase-list">
          {Array.from({ length: pageCount }, (_, page) => {
            const start = page * SHOWCASE_PAGE_SIZE;
            const slice = value.slice(start, start + SHOWCASE_PAGE_SIZE);
            return (
              <li key={`showcase-page-${page}`} data-testid="showcase-page">
                <p className="text-xs uppercase tracking-wider text-text-muted mb-1">
                  Page {page + 1}
                  {pageCount > 1 && <span className="text-text-secondary"> of {pageCount}</span>}
                </p>
                <ul className="divide-y divide-border-subtle border border-border-subtle rounded">
                  {slice.map((id, offset) => {
                    const index = start + offset;
                    const product = byId.get(id);
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-3 px-3 py-2"
                        data-testid="showcase-row"
                        data-product-id={id}
                      >
                        <span className="w-10 h-10 shrink-0 rounded border border-border-subtle bg-bg-base overflow-hidden flex items-center justify-center">
                          {product?.image_url ? (
                            <img src={product.image_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span aria-hidden="true" className="text-xs text-text-muted">—</span>
                          )}
                        </span>

                        <span className="flex-1 min-w-0">
                          {product ? (
                            <>
                              <span className="block truncate text-sm text-text-primary">
                                {product.name}
                              </span>
                              <span className="block text-xs text-text-muted font-mono">
                                {product.sku}
                              </span>
                            </>
                          ) : (
                            // Le produit a quitté le catalogue, ou la caisse : la
                            // vitrine le tait déjà (ADR-023 conséquence 5). On le
                            // dit ici, sinon la sélection ment sur ce qui s'affiche.
                            <span className="block text-sm text-warning" data-testid="showcase-row-stale">
                              No longer on sale — not shown on the display.
                            </span>
                          )}
                        </span>

                        {product && (
                          <Currency
                            amount={product.retail_price}
                            className="text-xs text-text-secondary shrink-0"
                          />
                        )}

                        <span className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            className={ROW_BTN}
                            disabled={disabled || index === 0}
                            onClick={() => { move(index, -1); }}
                            aria-label={`Move ${product?.name ?? 'item'} up`}
                            data-testid="showcase-move-up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className={ROW_BTN}
                            disabled={disabled || index === value.length - 1}
                            onClick={() => { move(index, 1); }}
                            aria-label={`Move ${product?.name ?? 'item'} down`}
                            data-testid="showcase-move-down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className={ROW_BTN}
                            disabled={disabled}
                            onClick={() => { remove(index); }}
                            aria-label={`Remove ${product?.name ?? 'item'} from the showcase`}
                            data-testid="showcase-remove"
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      )}

      {!disabled && !pickerOpen && (
        <button
          type="button"
          className={TOOLBAR_BTN_SECONDARY}
          onClick={() => { setPickerOpen(true); }}
          disabled={full}
          data-testid="showcase-add"
        >
          {full ? `Showcase full (${SHOWCASE_MAX})` : 'Add product'}
        </button>
      )}

      {pickerOpen && (
        <ShowcaseProductPicker
          excludeIds={value}
          onPick={(product) => {
            if (value.includes(product.id) || value.length >= SHOWCASE_MAX) return;
            onChange([...value, product.id]);
            setPickerOpen(false);
          }}
          onClose={() => { setPickerOpen(false); }}
        />
      )}
    </div>
  );
}
