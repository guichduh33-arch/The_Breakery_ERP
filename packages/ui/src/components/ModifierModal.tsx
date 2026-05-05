// packages/ui/src/components/ModifierModal.tsx
//
// Full-screen modal that lets the cashier customise a product before adding it
// to the cart. Shows one Card per group, big touch buttons for each option,
// and a real-time price total in the footer.
//
// v1: single_select only — tapping an option replaces the previous one in the
// same group. Required groups must have a selection before "Add to cart" is
// enabled. Default options pre-selected at open.
//
// Spec ref: 2026-05-05-session-2-modifiers-kds-spec.md §4.1

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
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
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/Card.js';
import { ScrollArea } from '../primitives/ScrollArea.js';
import { Currency } from './Currency.js';
import { FullScreenModal } from './FullScreenModal.js';

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

export interface ModifierModalProduct {
  id: string;
  name: string;
  retail_price: number;
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
    setSelections((prev) => {
      const existing = prev.find((s) => s.group_name === group.group_name);
      // single_select: tapping the already-selected option in a non-required
      // group toggles it OFF. In a required group, we keep at least the
      // previous selection (no-op).
      if (existing?.option_label === option.option_label) {
        if (group.group_required) return prev; // can't deselect required
        return prev.filter((s) => s.group_name !== group.group_name);
      }
      // Replace any prior selection of this group, then add the new one.
      const without = prev.filter((s) => s.group_name !== group.group_name);
      return [...without, next];
    });
  }

  function handleConfirm(): void {
    if (hasError) return;
    onConfirm(selections);
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Title asChild>
        <span className={cn(SR_ONLY)}>Customize {product.name}</span>
      </DialogPrimitive.Title>
      <DialogPrimitive.Description asChild>
        <span className={cn(SR_ONLY)}>
          Choose options for this product before adding it to the cart.
        </span>
      </DialogPrimitive.Description>
      <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-text-secondary">
            Customize
          </div>
          <h2 className="font-serif text-xl truncate">{product.name}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-4">
          {groups.length === 0 ? (
            <p className="text-text-secondary text-sm">No modifiers available.</p>
          ) : null}
          {groups.map((group) => {
            const showRequiredError = errorGroups.has(group.group_name);
            return (
              <Card key={group.group_name}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-base">{group.group_name}</CardTitle>
                  {group.group_required ? (
                    <Badge
                      variant={showRequiredError ? 'destructive' : 'secondary'}
                    >
                      Required
                    </Badge>
                  ) : (
                    <Badge variant="outline">Optional</Badge>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {group.options.map((option) => {
                      const selected = isSelected(
                        group.group_name,
                        option.option_label,
                      );
                      return (
                        <Button
                          key={option.option_label}
                          variant={selected ? 'gold' : 'secondary'}
                          size="lg"
                          className={cn(
                            'justify-between text-left normal-case tracking-normal',
                          )}
                          onClick={() => toggleOption(group, option)}
                          aria-pressed={selected}
                        >
                          <span className="flex items-center gap-2">
                            {option.option_icon ? (
                              <span aria-hidden className="text-lg">
                                {option.option_icon}
                              </span>
                            ) : null}
                            <span>{option.option_label}</span>
                          </span>
                          {option.price_adjustment > 0 ? (
                            <span className="text-xs">
                              +<Currency amount={option.price_adjustment} />
                            </span>
                          ) : null}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>

      <footer className="px-6 py-4 border-t border-border-subtle bg-bg-elevated flex items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-text-secondary">
            Total
          </div>
          <Currency
            amount={total}
            emphasis="gold"
            className="text-2xl font-semibold"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={handleConfirm}
            disabled={hasError}
            aria-disabled={hasError}
          >
            Add to cart
          </Button>
        </div>
      </footer>
    </FullScreenModal>
  );
}
