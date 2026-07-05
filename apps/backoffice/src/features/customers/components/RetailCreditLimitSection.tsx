// apps/backoffice/src/features/customers/components/RetailCreditLimitSection.tsx
//
// Session 62 Task 6 — editable "plafond ardoise" (tab credit ceiling) card
// for retail customers. Pure presentational, mirrors the props shape of
// B2BFieldsSection (values/canEdit/onChange contract) but owns a small local
// draft + Save affordance since this field is genuinely persisted (unlike
// B2BFieldsSection, which is not wired to any mutation in production).

import { useEffect, useState, type ChangeEvent, type JSX } from 'react';
import { Button, Card, Input } from '@breakery/ui';

export interface RetailCreditLimitSectionProps {
  value:   number | null;
  canEdit: boolean;
  saving?: boolean;
  onSave:  (next: number | null) => void;
}

export function RetailCreditLimitSection({
  value, canEdit, saving = false, onSave,
}: RetailCreditLimitSectionProps): JSX.Element {
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  // Reset the draft whenever the persisted value changes (e.g. after a
  // successful save, or a fresh customer load).
  useEffect(() => {
    setDraft(value === null ? '' : String(value));
  }, [value]);

  const parsed = draft.trim() === '' ? null : Number(draft);
  const isValid = parsed === null || (Number.isFinite(parsed) && parsed >= 0);
  const dirty = parsed !== value;

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    setDraft(e.target.value);
  }

  function handleSave(): void {
    if (!isValid || !dirty) return;
    onSave(parsed);
  }

  return (
    <Card variant="default" padding="md" className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">Ardoise</h2>
      <div className="space-y-1">
        <label htmlFor="retail_credit_limit" className="text-xs uppercase tracking-widest text-text-secondary">
          Plafond ardoise (vide = illimité)
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="retail_credit_limit"
            name="retail_credit_limit"
            value={draft}
            inputMode="numeric"
            readOnly={!canEdit}
            aria-invalid={!isValid}
            placeholder="Illimité"
            onChange={handleChange}
          />
          {canEdit && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!isValid || !dirty || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
        {!isValid && (
          <p className="text-red text-xs">Must be a positive number, or blank for unlimited</p>
        )}
      </div>
    </Card>
  );
}
