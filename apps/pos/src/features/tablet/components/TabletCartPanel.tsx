import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { ChevronRight, ShoppingBag } from 'lucide-react';
import { cn, Currency } from '@breakery/ui';
import { calculatePreview } from '@breakery/domain';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { TabletComboLine } from './TabletComboLine';

export interface TabletCartPanelProps {
  /**
   * Action rendue au pied du panier (l'envoi en cuisine). Le panneau ne
   * déclenche PLUS l'envoi lui-même : la page le porte, parce qu'elle seule
   * peut ouvrir le plan de salle quand il manque une table. Deux
   * implémentations de l'envoi coexistaient — c'en est une de trop.
   */
  footer?: ReactNode;
  /**
   * Forme compacte de LA MÊME action, rendue au pied du rail replié
   * (portrait). Sans elle, replier le panier faisait disparaître l'envoi —
   * exactement ce que le commentaire du pied déclare vouloir éviter. Même
   * handler côté page : deux rendus, une seule implémentation.
   */
  compactAction?: ReactNode;
}

const COLLAPSED_KEY = 'breakery.tablet-cart.collapsed';

export function TabletCartPanel({ footer, compactAction }: TabletCartPanelProps = {}): JSX.Element {
  const items = useTabletCartStore((s) => s.items);
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  const orderType = useTabletCartStore((s) => s.orderType);
  const notes = useTabletCartStore((s) => s.notes);
  const setNotes = useTabletCartStore((s) => s.setNotes);
  const updateQuantity = useTabletCartStore((s) => s.updateQuantity);
  const removeItem = useTabletCartStore((s) => s.removeItem);

  // Tax estimated at the SERVER config (business_config.tax_rate +
  // tax_inclusive) — the money-path RPC charges this same split. Display-only:
  // the server stays pricing authority.
  const { taxRate, taxInclusive } = useTaxConfig();
  const preview = calculatePreview({ items, tableNumber, orderType }, taxRate, taxInclusive);
  const taxPercentLabel = `${Math.round(taxRate * 100)}%`;
  const isEmpty = items.length === 0;
  const itemCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);

  // Ticket 5 — collapsible in portrait so the cart hands space back to the
  // product grid. Landscape always shows the full rail (CSS override below).
  // Persisté en sessionStorage comme le reste de la saisie : une mise en
  // veille qui rouvrait le panneau plein contredisait le geste de repli.
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem(COLLAPSED_KEY) === '1');
  useEffect(() => {
    sessionStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Ticket 2 — brief add-to-cart flash (<300ms) on the cart affordance when the
  // item count grows. Duration comes from the `--motion-base` token, which
  // collapses to 0ms under `prefers-reduced-motion` (see motion.css).
  const [flash, setFlash] = useState(false);
  const prevCountRef = useRef(itemCount);
  useEffect(() => {
    if (itemCount > prevCountRef.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 280);
      prevCountRef.current = itemCount;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = itemCount;
    return undefined;
  }, [itemCount]);

  const countBadge = (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full text-xs font-semibold tabular-nums transition-colors duration-base',
        flash ? 'bg-gold text-gold-fg' : 'bg-bg-overlay text-text-secondary',
      )}
      aria-hidden
    >
      {itemCount}
    </span>
  );

  return (
    <aside
      className={cn(
        'shrink-0 bg-bg-elevated border-l border-border-subtle flex flex-col transition-[width] duration-base',
        collapsed ? 'w-20 landscape:w-[340px]' : 'w-[340px]',
      )}
      data-testid="tablet-cart-panel"
    >
      {/* Collapsed rail (portrait only) — tap to expand. Hidden in landscape.
          Le CTA compact vit HORS du bouton d'expansion (un bouton dans un
          bouton est invalide) : l'envoi reste possible sans déplier. */}
      {collapsed && (
        <div className="landscape:hidden flex flex-col h-full w-full">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label={`Expand cart, ${itemCount} items`}
            aria-expanded={false}
            className={cn(
              'flex-1 flex flex-col items-center gap-3 pt-4 px-2 text-text-secondary',
              'transition-colors duration-base',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:-outline-offset-2',
              flash && 'bg-gold-soft',
            )}
          >
            <ShoppingBag className="h-6 w-6" aria-hidden />
            {countBadge}
            {!isEmpty && (
              <Currency amount={preview.total} className="text-xs tabular-nums text-center leading-tight" />
            )}
          </button>
          {compactAction !== undefined && <div className="p-2 pb-3">{compactAction}</div>}
        </div>
      )}

      {/* Full panel — hidden in portrait while collapsed, always shown in landscape. */}
      <div className={cn('flex-1 flex flex-col overflow-hidden', collapsed && 'portrait:hidden')}>
        <header
          className={cn(
            'p-4 border-b border-border-subtle flex items-center justify-between gap-2 transition-colors duration-base',
            flash && 'bg-gold-soft',
          )}
        >
          <div className="flex items-center gap-2">
            <h2 className="text-xs uppercase tracking-widest font-semibold text-text-primary">Order</h2>
            {!isEmpty && countBadge}
          </div>
          {/* Collapse control — portrait only (≥44px). */}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse cart"
            aria-expanded
            className="landscape:hidden h-11 w-11 -mr-2 grid place-items-center rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="h-full grid place-items-center text-text-muted">
              <div className="text-center space-y-2">
                <ShoppingBag className="h-12 w-12 mx-auto opacity-50" aria-hidden />
                <div className="text-sm uppercase tracking-widest">Empty</div>
              </div>
            </div>
          ) : (
            <ul className="p-3 space-y-3">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 rounded-md bg-bg-overlay p-2.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-text-primary truncate">{item.name}</div>
                      {/* Les modificateurs d'une ligne combo sont ses choix
                          d'options : la composition ci-dessous les dit déjà,
                          composant par composant (même partage qu'au comptoir). */}
                      {item.modifiers.length > 0 && item.combo_components === undefined && (
                        <div className="text-xs text-text-muted">
                          {item.modifiers.map((m) => m.option_label).join(' · ')}
                        </div>
                      )}
                      {/* Lot D — composition d'une ligne combo, sous son nom. */}
                      {item.combo_components !== undefined && (
                        <TabletComboLine
                          productId={item.product_id}
                          components={item.combo_components}
                        />
                      )}
                    </div>
                    {/* h-12/w-12 remove target — tablet-comfortable (LOT 6). */}
                    <button
                      className="h-12 w-12 shrink-0 grid place-items-center rounded-md bg-bg-input text-text-secondary hover:text-red-as-text text-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.name}`}
                    >
                      ×
                    </button>
                  </div>
                  {/* Quantity stepper — 48px targets (LOT 6). The shared
                      @breakery/ui QuantityStepper is h-8 (desktop) and not
                      size-configurable, so this row uses h-12 buttons inline. */}
                  {/* Critique 2026-08-24 — le « − » à quantité 1 était désactivé
                      et forçait à viser le « × » en haut de ligne ; il retire
                      désormais l'article, comme le pouce s'y attend. */}
                  <div className="flex items-center gap-2">
                    <button
                      className="h-12 w-12 grid place-items-center rounded-md bg-bg-input border border-border-subtle text-text-primary text-xl hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
                      onClick={() =>
                        item.quantity <= 1
                          ? removeItem(item.id)
                          : updateQuantity(item.id, item.quantity - 1)
                      }
                      aria-label={
                        // Libellé distinct du « × » (`Remove <name>`) : deux
                        // boutons au même nom accessible sur la même ligne
                        // sont indistinguables au lecteur d'écran.
                        item.quantity <= 1 ? `Remove last ${item.name}` : `Decrease ${item.name}`
                      }
                    >
                      −
                    </button>
                    <span className="min-w-10 text-center font-mono tabular-nums text-base">{item.quantity}</span>
                    <button
                      className="h-12 w-12 grid place-items-center rounded-md bg-bg-input border border-border-subtle text-text-primary text-xl hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      aria-label={`Increase ${item.name}`}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Le pied reste monté même panier vide : les totaux et la note n'ont
            alors rien à dire, mais l'action d'envoi doit rester visible (et
            désactivée) — un CTA qui disparaît laisse la serveuse chercher où
            envoyer. */}
        <footer className="p-4 border-t border-border-subtle space-y-3">
          {!isEmpty && (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">Items total</span>
                <Currency amount={preview.items_total} />
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>{taxInclusive ? 'Tax incl.' : 'Tax'} ({taxPercentLabel})</span>
                <Currency amount={preview.tax_amount} />
              </div>
              <div className="flex justify-between pt-2 border-t border-border-subtle">
                <span className="uppercase tracking-wide font-semibold">Est. Total</span>
                <Currency amount={preview.total} emphasis="gold" className="text-lg" />
              </div>
            </div>
          )}
          {/* Session 59 (17 D1.1) — order-level note (allergy, "no gluten"...). */}
          {!isEmpty && (
            <div className="space-y-1">
              <label htmlFor="tablet-order-note" className="text-xs uppercase tracking-widest text-text-muted">
                Note for kitchen
              </label>
              <textarea
                id="tablet-order-note"
                value={notes ?? ''}
                onChange={(e) => setNotes(e.target.value.length > 0 ? e.target.value : null)}
                placeholder="e.g. no gluten, nut allergy…"
                rows={2}
                className="w-full resize-none rounded-md bg-bg-input border border-border-subtle p-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              />
            </div>
          )}
          {footer}
        </footer>
      </div>
    </aside>
  );
}
