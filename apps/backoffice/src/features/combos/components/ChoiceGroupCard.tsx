// apps/backoffice/src/features/combos/components/ChoiceGroupCard.tsx
//
// Session 47 — A single configurable group card in the ComboBuilderPage.
// Contains group metadata + list of ComboOptionRows + "Add Product" picker.
// Note: @breakery/ui has no RadioGroup — uses native <select> (kept for form uniformity).

import { useState, type JSX } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { ComboOptionRow, type OptionDraft } from './ComboOptionRow.js';
import { ComboProductPicker } from './ComboProductPicker.js';
import type { ComboOptionProduct } from '../hooks/useFinishedProductsForCombo.js';

export interface GroupDraft {
  id: string; // client-side uuid for key stability
  name: string;
  group_type: 'single' | 'multi';
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: OptionDraft[];
}

interface Props {
  group: GroupDraft;
  onChange: (updated: GroupDraft) => void;
  onRemove: () => void;
}

export function ChoiceGroupCard({ group, onChange, onRemove }: Props): JSX.Element {
  const [showPicker, setShowPicker] = useState(false);

  function updateField<K extends keyof GroupDraft>(key: K, value: GroupDraft[K]) {
    onChange({ ...group, [key]: value });
  }

  function handlePickProduct(product: ComboOptionProduct) {
    const alreadyExists = group.options.some(
      (o) => o.component_product_id === product.id,
    );
    if (alreadyExists) {
      setShowPicker(false);
      return;
    }
    const isFirstOption = group.options.length === 0;
    const newOption: OptionDraft = {
      component_product_id: product.id,
      label: product.name + (product.variant_label !== null ? ` — ${product.variant_label}` : ''),
      surcharge: 0,
      is_default: isFirstOption, // first option is default
      sort_order: group.options.length,
    };
    onChange({ ...group, options: [...group.options, newOption] });
    setShowPicker(false);
  }

  function handleSetDefault(idx: number) {
    const updated = group.options.map((o, i) => ({ ...o, is_default: i === idx }));
    onChange({ ...group, options: updated });
  }

  function handleSurchargeChange(idx: number, value: number) {
    const updated = group.options.map((o, i) => (i === idx ? { ...o, surcharge: value } : o));
    onChange({ ...group, options: updated });
  }

  function handleRemoveOption(idx: number) {
    const remaining = group.options.filter((_, i) => i !== idx);
    // Ensure at least one default if single-type
    if (group.group_type === 'single' && remaining.length > 0) {
      const hasDefault = remaining.some((o) => o.is_default);
      if (!hasDefault && remaining[0] !== undefined) {
        remaining[0] = { ...remaining[0], is_default: true };
      }
    }
    onChange({ ...group, options: remaining });
  }

  const existingIds = group.options.map((o) => o.component_product_id);

  return (
    <div
      className="rounded-lg border border-border-subtle bg-bg-elevated p-4 space-y-3"
      data-testid={`group-card-${group.id}`}
    >
      {/* Group header row */}
      <div className="flex items-start gap-2">
        <ChevronDown className="h-4 w-4 text-text-muted mt-0.5 shrink-0" aria-hidden />
        <div className="flex-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`group-name-${group.id}`}
              className="block text-[10px] uppercase tracking-wider text-text-secondary mb-1"
            >
              Group Name
            </label>
            <input
              id={`group-name-${group.id}`}
              value={group.name}
              onChange={(e) => { updateField('name', e.target.value); }}
              placeholder="e.g. Choose a drink"
              className="w-full px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded"
              data-testid={`group-name-${group.id}`}
            />
          </div>

          <div>
            <label
              htmlFor={`group-type-${group.id}`}
              className="block text-[10px] uppercase tracking-wider text-text-secondary mb-1"
            >
              Type
            </label>
            <select
              id={`group-type-${group.id}`}
              value={group.group_type}
              onChange={(e) => {
                const t = e.target.value as 'single' | 'multi';
                const next = { ...group, group_type: t };
                if (t === 'single') {
                  // single: min/max both 1, enforce exactly one default
                  next.min_select = 1;
                  next.max_select = 1;
                  const hasDefault = next.options.some((o) => o.is_default);
                  if (!hasDefault && next.options.length > 0) {
                    next.options = next.options.map((o, i) => ({ ...o, is_default: i === 0 }));
                  }
                } else {
                  // multi: default to select 1+
                  next.min_select = 0;
                  next.max_select = Math.max(1, next.options.length);
                }
                onChange(next);
              }}
              className="w-full px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded"
              data-testid={`group-type-${group.id}`}
            >
              <option value="single">Single choice</option>
              <option value="multi">Multi choice</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 mt-5 text-text-muted hover:text-red transition-colors"
          aria-label={`Remove group ${group.name}`}
          data-testid={`remove-group-${group.id}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Required + min/max controls */}
      <div className="flex flex-wrap items-center gap-4 px-1">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={group.is_required}
            onChange={(e) => { updateField('is_required', e.target.checked); }}
            className="accent-gold"
            data-testid={`group-required-${group.id}`}
          />
          <span className="text-xs text-text-secondary">Required</span>
        </label>

        {group.group_type === 'multi' && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-secondary">Min</span>
              <input
                type="number"
                min={0}
                max={group.max_select}
                value={group.min_select}
                onChange={(e) => { updateField('min_select', Math.max(0, Number(e.target.value))); }}
                className="w-14 px-1.5 py-0.5 text-xs bg-bg-base border border-border-subtle rounded text-center"
                data-testid={`group-min-${group.id}`}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-secondary">Max</span>
              <input
                type="number"
                min={1}
                value={group.max_select}
                onChange={(e) => { updateField('max_select', Math.max(1, Number(e.target.value))); }}
                className="w-14 px-1.5 py-0.5 text-xs bg-bg-base border border-border-subtle rounded text-center"
                data-testid={`group-max-${group.id}`}
              />
            </div>
          </>
        )}
      </div>

      {/* Options list */}
      <div className="space-y-1.5">
        {group.options.map((opt, idx) => (
          <ComboOptionRow
            key={opt.component_product_id}
            option={opt}
            isDefault={opt.is_default}
            groupType={group.group_type}
            onSetDefault={() => { handleSetDefault(idx); }}
            onSurchargeChange={(v) => { handleSurchargeChange(idx, v); }}
            onRemove={() => { handleRemoveOption(idx); }}
          />
        ))}
        {group.options.length === 0 && (
          <p className="text-xs italic text-text-muted px-1">No options yet — add a product.</p>
        )}
      </div>

      {/* Add product button / picker */}
      {showPicker ? (
        <ComboProductPicker
          excludeIds={existingIds}
          onPick={handlePickProduct}
          onClose={() => { setShowPicker(false); }}
        />
      ) : (
        <button
          type="button"
          onClick={() => { setShowPicker(true); }}
          className="flex items-center gap-1.5 text-xs text-gold hover:text-gold-hover transition-colors"
          data-testid={`add-option-${group.id}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add Product
        </button>
      )}
    </div>
  );
}
