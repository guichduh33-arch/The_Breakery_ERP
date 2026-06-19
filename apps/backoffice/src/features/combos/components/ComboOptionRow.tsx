// apps/backoffice/src/features/combos/components/ComboOptionRow.tsx
//
// Session 47 — A single option row in a ChoiceGroupCard.
// Shows product label + surcharge input + set-default / remove buttons.

import { Trash2 } from 'lucide-react';
import type { JSX } from 'react';

export interface OptionDraft {
  component_product_id: string;
  label: string;
  surcharge: number;
  is_default: boolean;
  sort_order: number;
}

interface Props {
  option: OptionDraft;
  isDefault: boolean;
  groupType: 'single' | 'multi';
  onSetDefault: () => void;
  onSurchargeChange: (value: number) => void;
  onRemove: () => void;
}

export function ComboOptionRow({
  option,
  isDefault,
  groupType,
  onSetDefault,
  onSurchargeChange,
  onRemove,
}: Props): JSX.Element {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-base px-3 py-2"
      data-testid={`option-row-${option.component_product_id}`}
    >
      <span className="flex-1 min-w-0 truncate text-sm text-text-primary">{option.label}</span>

      <div className="flex items-center gap-1 shrink-0">
        <span className="text-xs text-text-secondary">+Rp</span>
        <input
          type="number"
          min={0}
          step={1000}
          value={option.surcharge}
          onChange={(e) => { onSurchargeChange(Math.max(0, Number(e.target.value))); }}
          className="w-20 px-1.5 py-1 text-xs bg-bg-elevated border border-border-subtle rounded text-right"
          aria-label={`Surcharge for ${option.label}`}
          data-testid={`surcharge-input-${option.component_product_id}`}
        />
      </div>

      {groupType === 'single' ? (
        <button
          type="button"
          onClick={onSetDefault}
          className={
            isDefault
              ? 'shrink-0 text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 bg-gold text-bg-base'
              : 'shrink-0 text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 border border-border-subtle text-text-secondary hover:border-gold hover:text-gold transition-colors'
          }
          aria-label={isDefault ? 'Default option' : `Set ${option.label} as default`}
          data-testid={`set-default-${option.component_product_id}`}
        >
          {isDefault ? 'Default' : 'Set Default'}
        </button>
      ) : (
        <span
          className={
            isDefault
              ? 'shrink-0 text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 bg-gold-soft text-gold'
              : ''
          }
        >
          {isDefault ? 'Pre-checked' : ''}
        </span>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-text-muted hover:text-red transition-colors"
        aria-label={`Remove ${option.label}`}
        data-testid={`remove-option-${option.component_product_id}`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
