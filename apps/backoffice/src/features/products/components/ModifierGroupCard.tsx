// apps/backoffice/src/features/products/components/ModifierGroupCard.tsx
//
// Edits one modifier group (variant type): name, type (single/multi), required,
// and its options. Bubbles the whole edited group up via onChange.

import type { JSX } from 'react';
import { Button, Card } from '@breakery/ui';
import { Trash2, Plus } from 'lucide-react';
import type {
  EditableModifierGroup,
  EditableModifierOption,
  ModifierGroupType,
} from '@breakery/domain';
import { ModifierOptionRow } from './ModifierOptionRow.js';

export interface ModifierGroupCardProps {
  group: EditableModifierGroup;
  onChange: (next: EditableModifierGroup) => void;
  onRemove: () => void;
}

const BLANK_OPTION: EditableModifierOption = {
  option_label: '',
  price_adjustment: 0,
  is_default: false,
  option_sort_order: 0,
  ingredients_to_deduct: [],
};

export function ModifierGroupCard({
  group,
  onChange,
  onRemove,
}: ModifierGroupCardProps): JSX.Element {
  function patch(p: Partial<EditableModifierGroup>): void {
    onChange({ ...group, ...p });
  }

  function changeOption(idx: number, next: EditableModifierOption): void {
    onChange({
      ...group,
      options: group.options.map((o, i) => (i === idx ? next : o)),
    });
  }

  function makeDefault(idx: number): void {
    onChange({
      ...group,
      options: group.options.map((o, i) => ({ ...o, is_default: i === idx })),
    });
  }

  function removeOption(idx: number): void {
    onChange({ ...group, options: group.options.filter((_, i) => i !== idx) });
  }

  function addOption(): void {
    onChange({ ...group, options: [...group.options, { ...BLANK_OPTION }] });
  }

  function changeType(t: ModifierGroupType): void {
    // Switching to single_select with >1 default would be invalid; keep the first.
    if (t === 'single_select') {
      let seen = false;
      const options = group.options.map((o) => {
        if (o.is_default && !seen) {
          seen = true;
          return o;
        }
        return { ...o, is_default: false };
      });
      onChange({ ...group, group_type: t, options });
    } else {
      patch({ group_type: t });
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Variant type name"
          className="flex-1 min-w-48 rounded border border-border-subtle bg-bg-input px-2 py-1 text-sm font-semibold"
          placeholder="e.g. Milk"
          value={group.group_name}
          onChange={(e) => patch({ group_name: e.target.value })}
        />
        <select
          aria-label="Selection type"
          className="rounded border border-border-subtle bg-bg-input px-2 py-1 text-sm"
          value={group.group_type}
          onChange={(e) => changeType(e.target.value as ModifierGroupType)}
        >
          <option value="single_select">Single choice</option>
          <option value="multi_select">Multiple choice</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          <input
            type="checkbox"
            aria-label="Required"
            checked={group.group_required}
            onChange={(e) => patch({ group_required: e.target.checked })}
          />
          Required
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Remove variant type"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {group.options.map((o, idx) => (
          <ModifierOptionRow
            key={idx}
            option={o}
            groupType={group.group_type}
            onChange={(next) => changeOption(idx, next)}
            onRemove={() => removeOption(idx)}
            onMakeDefault={() => makeDefault(idx)}
          />
        ))}
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={addOption}>
        <Plus className="mr-1 h-4 w-4" /> Add option
      </Button>
    </Card>
  );
}
