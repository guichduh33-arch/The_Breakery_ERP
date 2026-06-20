// apps/backoffice/src/features/products/components/ModifierOptionRow.tsx
//
// Edits a single modifier option: label, price adjustment (IDR), default
// (radio for single_select, checkbox for multi_select), ingredients-to-deduct.

import type { JSX } from 'react';
import { Button } from '@breakery/ui';
import { Trash2 } from 'lucide-react';
import type {
  EditableModifierOption,
  ModifierGroupType,
  ModifierIngredient,
} from '@breakery/domain';
import { OptionIngredientPicker } from './OptionIngredientPicker.js';

export interface ModifierOptionRowProps {
  option: EditableModifierOption;
  groupType: ModifierGroupType;
  onChange: (next: EditableModifierOption) => void;
  onRemove: () => void;
  /** single_select only — request this option becomes the sole default. */
  onMakeDefault: () => void;
}

export function ModifierOptionRow({
  option,
  groupType,
  onChange,
  onRemove,
  onMakeDefault,
}: ModifierOptionRowProps): JSX.Element {
  return (
    <div className="rounded border border-border-subtle p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          aria-label="Option label"
          className="flex-1 rounded border border-border-subtle bg-bg-input px-2 py-1 text-sm"
          placeholder="e.g. Oat milk"
          value={option.option_label}
          onChange={(e) => onChange({ ...option, option_label: e.target.value })}
        />
        <label className="flex items-center gap-1 text-xs text-text-muted">
          + IDR
          <input
            aria-label="Price adjustment"
            type="number"
            step="1"
            className="w-28 rounded border border-border-subtle bg-bg-input px-2 py-1 text-sm"
            value={option.price_adjustment}
            onChange={(e) =>
              onChange({ ...option, price_adjustment: Number(e.target.value) || 0 })
            }
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          {groupType === 'single_select' ? (
            <input
              type="radio"
              aria-label="Default option"
              checked={option.is_default}
              onChange={onMakeDefault}
            />
          ) : (
            <input
              type="checkbox"
              aria-label="Default option"
              checked={option.is_default}
              onChange={(e) => onChange({ ...option, is_default: e.target.checked })}
            />
          )}
          Default
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Remove option"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <OptionIngredientPicker
        value={option.ingredients_to_deduct}
        onChange={(next: ModifierIngredient[]) =>
          onChange({ ...option, ingredients_to_deduct: next })
        }
      />
    </div>
  );
}
