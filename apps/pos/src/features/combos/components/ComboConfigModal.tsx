// apps/pos/src/features/combos/components/ComboConfigModal.tsx
//
// Session 47 — POS modal for configuring a combo product before adding to cart.
//
// Renders one section per combo group; cashier picks an option per group
// (radio for single groups, checkbox for multi groups). Shows a live price
// summary. Confirm is disabled until validateSelection passes.
//
// DEV-S47-D2-01 (deviation from plan): ComboSelection[] is internal state only.
// onConfirm emits {components, modifiers, unitPrice} as D3 expects — not the
// raw selection. The plan listed `selection` in the signature but D3 only needs
// the resolved payload.

import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@breakery/ui';
import {
  configuredPrice,
  validateSelection,
  type ComboDefinition,
  type ComboGroup,
  type ComboSelection,
  type ModifierOption,
} from '@breakery/domain';
import { formatIdr } from '@breakery/utils';
import { useComboConfig } from '@/features/combos/hooks/useComboConfig';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ComboConfigModalProps {
  open: boolean;
  /** The combo product tapped on the POS grid. */
  product: { id: string; name: string } | null;
  onConfirm: (result: {
    components: { product_id: string; quantity: number }[];
    modifiers: ModifierOption[];
    unitPrice: number;
  }) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the default selection from a definition (is_default options). */
function buildDefaultSelection(def: ComboDefinition): ComboSelection[] {
  return def.groups.map((g) => ({
    group_id: g.id,
    option_ids: g.options.filter((o) => o.is_default).map((o) => o.id),
  }));
}

/** Toggle one optionId in a multi-select group's selection list. */
function toggleMulti(sel: ComboSelection[], groupId: string, optionId: string): ComboSelection[] {
  return sel.map((s) => {
    if (s.group_id !== groupId) return s;
    const has = s.option_ids.includes(optionId);
    return {
      ...s,
      option_ids: has ? s.option_ids.filter((id) => id !== optionId) : [...s.option_ids, optionId],
    };
  });
}

/** Replace the single selection for a single group. */
function setSingle(sel: ComboSelection[], groupId: string, optionId: string): ComboSelection[] {
  return sel.map((s) => {
    if (s.group_id !== groupId) return s;
    return { ...s, option_ids: [optionId] };
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComboConfigModal({
  open,
  product,
  onConfirm,
  onClose,
}: ComboConfigModalProps): JSX.Element {
  const { data: def, isLoading } = useComboConfig(product?.id ?? '');

  // Internal selection state — reset whenever the loaded definition changes
  // (i.e. when a different product is opened).
  const [selection, setSelection] = useState<ComboSelection[]>([]);

  useEffect(() => {
    if (def) {
      setSelection(buildDefaultSelection(def));
    }
  }, [def]);

  // Validation
  const validation = useMemo(() => {
    if (!def) return { ok: false as const, errors: ['Loading...'] };
    return validateSelection(def, selection);
  }, [def, selection]);

  const totalPrice = useMemo(() => {
    if (!def) return 0;
    return configuredPrice(def, selection);
  }, [def, selection]);

  function handleConfirm() {
    if (!def || !validation.ok) return;

    const components: { product_id: string; quantity: number }[] = [];
    const modifiers: ModifierOption[] = [];

    for (const group of def.groups) {
      const selForGroup = selection.find((s) => s.group_id === group.id);
      if (!selForGroup) continue;
      for (const optionId of selForGroup.option_ids) {
        const option = group.options.find((o) => o.id === optionId);
        if (!option) continue;
        components.push({ product_id: option.component_product_id, quantity: 1 });
        modifiers.push({
          group_name: group.name,
          option_label: option.label,
          price_adjustment: option.surcharge,
        });
      }
    }

    // unitPrice = base_price; surcharges ride as modifiers
    onConfirm({ components, modifiers, unitPrice: def.base_price });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product?.name ?? 'Configure combo'}</DialogTitle>
          <Badge variant="outline" className="w-fit">
            COMBO
          </Badge>
        </DialogHeader>

        {isLoading || !def ? (
          <div className="py-8 text-center text-text-muted">Loading…</div>
        ) : (
          <>
            <div className="space-y-6">
              {def.groups.map((group) => (
                <GroupSection
                  key={group.id}
                  group={group}
                  selection={selection}
                  onSelect={setSelection}
                />
              ))}
            </div>

            {/* Price summary */}
            <div className="mt-4 flex items-center justify-between rounded-lg bg-bg-subtle px-4 py-3">
              <span className="text-sm font-medium text-text-muted">Total</span>
              <span className="font-mono text-xl font-bold text-gold">
                {formatIdr(totalPrice)}
              </span>
            </div>

            {/* Actions */}
            <div className="mt-2 flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={!validation.ok}
                onClick={handleConfirm}
              >
                Confirm
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// GroupSection sub-component
// ---------------------------------------------------------------------------

interface GroupSectionProps {
  group: ComboGroup;
  selection: ComboSelection[];
  onSelect: React.Dispatch<React.SetStateAction<ComboSelection[]>>;
}

function GroupSection({ group, selection, onSelect }: GroupSectionProps): JSX.Element {
  const selForGroup = selection.find((s) => s.group_id === group.id);
  const chosenIds = selForGroup?.option_ids ?? [];
  const atMax = group.group_type === 'multi' && chosenIds.length >= group.max_select;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-base font-semibold">{group.name}</h3>
        {group.is_required && (
          <span className="text-xs font-medium text-text-muted">
            {group.group_type === 'multi'
              ? `${group.min_select}–${group.max_select}`
              : 'Required'}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {group.options.map((option) => {
          const isChosen = chosenIds.includes(option.id);
          // Disable unchecked options when multi group is at max_select
          const disabledByMax = group.group_type === 'multi' && !isChosen && atMax;

          if (group.group_type === 'single') {
            return (
              <label
                key={option.id}
                className={`flex min-h-[3.5rem] cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  isChosen
                    ? 'border-gold bg-gold/10'
                    : 'border-border-subtle bg-bg-card hover:bg-bg-subtle'
                }`}
              >
                <input
                  type="radio"
                  name={`group-${group.id}`}
                  value={option.id}
                  checked={isChosen}
                  onChange={() =>
                    onSelect((prev) => setSingle(prev, group.id, option.id))
                  }
                  className="sr-only"
                  aria-label={option.label}
                />
                {/* Custom radio indicator */}
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    isChosen ? 'border-gold bg-gold' : 'border-border-default bg-transparent'
                  }`}
                >
                  {isChosen && (
                    <span className="h-2 w-2 rounded-full bg-bg-base" />
                  )}
                </span>
                <span className="flex-1 text-base">{option.label}</span>
                {option.surcharge > 0 && (
                  <span className="font-mono text-sm text-text-muted">
                    +{formatIdr(option.surcharge)}
                  </span>
                )}
              </label>
            );
          }

          // Multi group — checkbox
          return (
            <label
              key={option.id}
              className={`flex min-h-[3.5rem] cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                disabledByMax
                  ? 'cursor-not-allowed border-border-subtle bg-bg-muted opacity-50'
                  : isChosen
                    ? 'border-gold bg-gold/10'
                    : 'border-border-subtle bg-bg-card hover:bg-bg-subtle'
              }`}
            >
              <input
                type="checkbox"
                checked={isChosen}
                disabled={disabledByMax}
                onChange={() =>
                  onSelect((prev) => toggleMulti(prev, group.id, option.id))
                }
                className="sr-only"
                aria-label={option.label}
              />
              {/* Custom checkbox indicator */}
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                  isChosen ? 'border-gold bg-gold' : 'border-border-default bg-transparent'
                }`}
              >
                {isChosen && (
                  <svg
                    viewBox="0 0 10 10"
                    className="h-3 w-3 fill-none stroke-bg-base stroke-2"
                  >
                    <polyline points="1.5,5 4,7.5 8.5,2.5" />
                  </svg>
                )}
              </span>
              <span className="flex-1 text-base">{option.label}</span>
              {option.surcharge > 0 && (
                <span className="font-mono text-sm text-text-muted">
                  +{formatIdr(option.surcharge)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
