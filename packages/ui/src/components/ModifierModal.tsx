// packages/ui/src/components/ModifierModal.tsx
//
// Session 14 / Phase 2.C — restyled per refs 20-22.
//
// The cashier customises a product before adding it to the cart. The modal
// is now a centered card on the dark backdrop (NOT full-screen) — matches
// the screenshots which keep the underlying product grid faintly visible.
//
// Layout (refs 20/21/22) :
//   Header row : small rounded product thumbnail (image_url with fallback)
//                + product name (Playfair) + "Choose your options" sub-copy
//                + X close icon (top-right).
//   Body       : per-group sections stacked vertically. Each group :
//                  - small uppercase label with red asterisk if required
//                  - 2-column grid of pill-style buttons. Selected = gold
//                    border + inner fill ; modifier with +Rp shows the
//                    delta below the label.
//   Footer     : "Total price:  Rp 35,000" row + gold gradient "ADD TO
//                CART · Rp 35,000" CTA.
//
// v2 (session 6) multi-select groups remain supported — selected options
// get the gold border treatment identical to single-select selected state.
//
// Spec ref: 2026-05-05-session-2-modifiers-kds-spec.md §4.1
//           2026-05-06-session-6-discounts-multi-modifiers-loyalty-mult-spec.md §4.6
//           2026-05-14-session-14-screenshot-audit.md rows 20-22

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, X } from 'lucide-react';
import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  calculatePriceAdjustment,
  validateSelections,
  type ModifierGroup,
  type ModifierGroupOption,
  type ModifierOption,
  type SelectedModifiers,
} from '@breakery/domain';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Currency } from './Currency.js';
import { FullScreenModal } from './FullScreenModal.js';

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

export interface ModifierModalProduct {
  id: string;
  name: string;
  retail_price: number;
  /** Optional product photo for the small thumbnail in the header. */
  image_url?: string | null;
}

export interface ModifierModalProps {
  open: boolean;
  product: ModifierModalProduct;
  groups: ModifierGroup[];
  onClose: () => void;
  onConfirm: (selections: SelectedModifiers) => void;
}

/** Compute initial selections from `is_default` flags. */
function defaultSelections(groups: ModifierGroup[]): SelectedModifiers {
  const selections: SelectedModifiers = [];
  for (const group of groups) {
    const def = group.options.find((o) => o.is_default);
    if (def) {
      selections.push({
        group_name: group.group_name,
        option_label: def.option_label,
        price_adjustment: def.price_adjustment,
      });
    }
  }
  return selections;
}

export function ModifierModal({
  open,
  product,
  groups,
  onClose,
  onConfirm,
}: ModifierModalProps): JSX.Element {
  const [selections, setSelections] = useState<SelectedModifiers>(() =>
    defaultSelections(groups),
  );

  // Reset selections whenever the modal is (re)opened or product changes.
  useEffect(() => {
    if (open) setSelections(defaultSelections(groups));
  }, [open, product.id, groups]);

  const errors = useMemo(
    () => validateSelections(groups, selections),
    [groups, selections],
  );
  const errorGroups = useMemo(
    () => new Set(errors.map((e) => e.group_name)),
    [errors],
  );
  const hasError = errors.length > 0;
  const total = product.retail_price + calculatePriceAdjustment(selections);

  function isSelected(groupName: string, optionLabel: string): boolean {
    return selections.some(
      (s) => s.group_name === groupName && s.option_label === optionLabel,
    );
  }

  function toggleOption(group: ModifierGroup, option: ModifierGroupOption): void {
    const next: ModifierOption = {
      group_name: group.group_name,
      option_label: option.option_label,
      price_adjustment: option.price_adjustment,
    };

    if (group.group_type === 'multi_select') {
      setSelections((prev) => {
        const alreadySelected = prev.some(
          (s) => s.group_name === group.group_name && s.option_label === option.option_label,
        );
        if (alreadySelected) {
          // Prevent deselecting the last option in a required group.
          if (group.group_required) {
            const groupSelections = prev.filter((s) => s.group_name === group.group_name);
            if (groupSelections.length <= 1) return prev;
          }
          return prev.filter(
            (s) => !(s.group_name === group.group_name && s.option_label === option.option_label),
          );
        }
        return [...prev, next];
      });
      return;
    }

    // single_select : tapping the already-selected option in a non-required
    // group toggles it OFF. In a required group, we keep the prior selection.
    setSelections((prev) => {
      const existing = prev.find((s) => s.group_name === group.group_name);
      if (existing?.option_label === option.option_label) {
        if (group.group_required) return prev;
        return prev.filter((s) => s.group_name !== group.group_name);
      }
      const without = prev.filter((s) => s.group_name !== group.group_name);
      return [...without, next];
    });
  }

  function handleConfirm(): void {
    if (hasError) return;
    onConfirm(selections);
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && onClose()} accessibleTitle={`Customize ${product.name}`}>
      <DialogPrimitive.Title asChild>
        <span className={cn(SR_ONLY)}>Customize {product.name}</span>
      </DialogPrimitive.Title>
      <DialogPrimitive.Description asChild>
        <span className={cn(SR_ONLY)}>
          Choose options for this product before adding it to the cart.
        </span>
      </DialogPrimitive.Description>

      <div
        className="m-auto bg-bg-overlay rounded-2xl border border-border-subtle shadow-modal w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden"
        data-testid="modifier-modal"
      >
        {/* Header */}
        <header className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border-subtle">
          <ProductThumb name={product.name} imageUrl={product.image_url ?? null} />
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg leading-tight text-text-primary truncate">
              {product.name}
            </h2>
            <p className="text-text-secondary text-xs">Choose your options</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {groups.length === 0 ? (
            <p className="text-text-secondary text-sm text-center py-2">
              No additional modifiers for this product.
            </p>
          ) : null}

          {groups.map((group) => {
            const showRequiredError = errorGroups.has(group.group_name);
            return (
              <section key={group.group_name} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-widest text-text-primary">
                    {group.group_name}
                  </span>
                  {group.group_required && (
                    <span
                      aria-label="required"
                      className={cn(
                        'text-base leading-none',
                        showRequiredError ? 'text-danger' : 'text-danger/80',
                      )}
                    >
                      *
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {group.options.map((option) => {
                    const selected = isSelected(group.group_name, option.option_label);
                    return (
                      <button
                        key={option.option_label}
                        type="button"
                        onClick={() => toggleOption(group, option)}
                        aria-pressed={selected}
                        className={cn(
                          'relative rounded-md border-2 px-3 py-3 text-center text-sm font-bold uppercase tracking-wide transition-colors',
                          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                          selected
                            ? 'border-gold bg-bg-input text-text-primary'
                            : 'border-border-subtle bg-bg-input/80 text-text-secondary hover:text-text-primary hover:border-border-strong',
                        )}
                      >
                        {group.group_type === 'multi_select' && (
                          <span
                            aria-hidden
                            className={cn(
                              'absolute top-1.5 right-1.5 h-3.5 w-3.5 rounded-sm border-2 grid place-items-center',
                              selected ? 'border-gold bg-gold text-bg-base' : 'border-border-strong bg-transparent',
                            )}
                          >
                            {selected ? <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden /> : null}
                          </span>
                        )}
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="leading-tight">
                            {option.option_icon ? (
                              <span aria-hidden className="mr-1.5">{option.option_icon}</span>
                            ) : null}
                            {option.option_label}
                          </span>
                          {option.price_adjustment > 0 && (
                            <span className="text-[10px] font-medium normal-case tracking-normal text-gold">
                              +<Currency amount={option.price_adjustment} />
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {/* Total price card */}
          <div className="bg-bg-input border border-border-subtle rounded-md px-4 py-3 flex items-center justify-between mt-2">
            <span className="text-sm text-text-secondary">Total price:</span>
            <Currency amount={total} emphasis="gold" className="text-base font-semibold" />
          </div>
        </div>

        {/* Footer CTA */}
        <footer className="px-5 pb-5">
          <Button
            variant="gold"
            size="lg"
            className="w-full uppercase tracking-widest font-semibold"
            onClick={handleConfirm}
            disabled={hasError}
            aria-disabled={hasError}
            data-testid="modifier-add-to-cart"
          >
            <span className="inline-flex items-center gap-2">
              <Check className="h-4 w-4" aria-hidden />
              Add to Cart · <Currency amount={total} className="text-bg-base" />
            </span>
          </Button>
        </footer>
      </div>
    </FullScreenModal>
  );
}

/** Square thumbnail with image fallback (silhouette gradient). */
function ProductThumb({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl: string | null;
}): JSX.Element {
  return (
    <div
      aria-hidden
      className="h-12 w-12 rounded-md overflow-hidden flex-shrink-0 bg-gradient-to-br from-bg-input to-bg-base border border-border-subtle grid place-items-center"
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="text-text-muted text-xs font-display uppercase">
          {name.charAt(0)}
        </span>
      )}
    </div>
  );
}
