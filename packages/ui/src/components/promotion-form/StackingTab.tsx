// packages/ui/src/components/promotion-form/StackingTab.tsx
//
// "Stacking" tab: priority + stackability toggles (with other promos / with a
// manual cashier discount).

import type { JSX } from 'react';
import { Field, NumberInput } from './fields.js';
import type { PromotionFormUpdate, PromotionFormValues } from './types.js';

export interface StackingTabProps {
  values: PromotionFormValues;
  update: PromotionFormUpdate;
}

export function StackingTab({ values, update }: StackingTabProps): JSX.Element {
  return (
    <div className="space-y-4">
      <Field label="Priority" htmlFor="promo-priority" hint="Higher applied first">
        <NumberInput
          id="promo-priority"
          value={values.priority}
          onChange={(n) => update('priority', n ?? 0)}
          step={1}
        />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.stackable_with_promo}
          onChange={(e) => update('stackable_with_promo', e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="text-text-primary">Stackable with other promotions</span>
          <span className="block text-xs text-text-secondary">
            Both promos must opt-in for stacking to apply.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.stackable_with_manual}
          onChange={(e) => update('stackable_with_manual', e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="text-text-primary">Stackable with manual cashier discount</span>
          <span className="block text-xs text-text-secondary">
            Defaults to true — typical behaviour.
          </span>
        </span>
      </label>
    </div>
  );
}
