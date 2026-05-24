// apps/backoffice/src/features/settings/expense-thresholds/ThresholdFormDialog.tsx
// S28 — wave 5.E — create/edit modal for expense approval thresholds with steps builder.
//
// Select/Label/Input: native HTML elements (project convention — @breakery/ui has no Select/Label exports).
// Only Button + Dialog* come from @breakery/ui.
import { useState, useEffect } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { Trash2, Plus } from 'lucide-react';
import { useSetExpenseThreshold } from './hooks/useSetExpenseThreshold.js';
import type { ApprovalStep, ExpenseThresholdRow } from './hooks/useExpenseThresholds.js';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ExpenseThresholdRow | null;
  categories: { id: string; name: string }[];
}

const ROLE_OPTIONS = ['CASHIER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const;

const LABEL_CLS = 'text-xs uppercase tracking-widest text-text-secondary';
const INPUT_CLS  = 'h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary';
const SELECT_CLS = 'h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary';

export function ThresholdFormDialog({ open, onOpenChange, initial, categories }: Props): JSX.Element {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amountMin, setAmountMin]   = useState<number>(0);
  const [amountMax, setAmountMax]   = useState<number>(100000);
  const [steps, setSteps]           = useState<ApprovalStep[]>([]);
  const setMut = useSetExpenseThreshold();

  useEffect(() => {
    if (open) {
      setCategoryId(initial?.category_id ?? null);
      setAmountMin(initial?.amount_min ?? 0);
      setAmountMax(initial?.amount_max ?? 100000);
      setSteps(initial?.steps ?? []);
    }
  }, [open, initial]);

  const addStep = (): void =>
    setSteps((s) => [...s, { role_codes: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'], label: 'Approval' }]);

  const removeStep = (idx: number): void =>
    setSteps((s) => s.filter((_, i) => i !== idx));

  const updateStepLabel = (idx: number, label: string): void =>
    setSteps((s) => s.map((st, i) => (i === idx ? { ...st, label } : st)));

  const toggleStepRole = (idx: number, role: string): void =>
    setSteps((s) =>
      s.map((st, i) =>
        i === idx
          ? {
              ...st,
              role_codes: st.role_codes.includes(role)
                ? st.role_codes.filter((r) => r !== role)
                : [...st.role_codes, role],
            }
          : st,
      ),
    );

  const submit = async (): Promise<void> => {
    try {
      await setMut.mutateAsync({
        threshold_id: initial?.id ?? null,
        category_id: categoryId,
        amount_min: amountMin,
        amount_max: amountMax,
        steps,
      });
      onOpenChange(false);
    } catch {
      // error surfaced via setMut.error
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle data-testid="threshold-form-title">
            {initial != null ? 'Edit threshold' : 'New threshold'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category selector */}
          <div>
            <label className={LABEL_CLS}>Category</label>
            <select
              className={SELECT_CLS}
              value={categoryId ?? '__all__'}
              onChange={(e) => setCategoryId(e.target.value === '__all__' ? null : e.target.value)}
            >
              <option value="__all__">All categories (default)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Amount range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Amount min (IDR)</label>
              <input
                type="number"
                className={INPUT_CLS}
                value={amountMin}
                min={0}
                onChange={(e) => setAmountMin(Number(e.target.value))}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Amount max (IDR, exclusive)</label>
              <input
                type="number"
                className={INPUT_CLS}
                value={amountMax}
                min={0}
                onChange={(e) => setAmountMax(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Approval steps builder */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className={LABEL_CLS}>Approval steps</label>
              <Button variant="secondary" size="sm" onClick={addStep} data-testid="add-step-btn">
                <Plus className="w-4 h-4 mr-1" />
                Add step
              </Button>
            </div>
            <p className="text-sm text-text-secondary mb-2">
              {steps.length === 0 ? 'No steps → auto-approve' : `${steps.length} step(s) required`}
            </p>
            {steps.map((step, idx) => (
              <div
                key={idx}
                className="border border-border-subtle rounded-md p-3 mb-2 space-y-2"
                data-testid={`step-row-${idx}`}
              >
                <div className="flex items-center gap-2">
                  <input
                    className={INPUT_CLS}
                    value={step.label}
                    onChange={(e) => updateStepLabel(idx, e.target.value)}
                    placeholder="Step label"
                  />
                  <button
                    type="button"
                    onClick={() => removeStep(idx)}
                    className="flex-shrink-0 p-1 rounded hover:bg-bg-hover text-text-secondary"
                    aria-label={`Remove step ${idx + 1}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {ROLE_OPTIONS.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => toggleStepRole(idx, role)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        step.role_codes.includes(role)
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-bg-muted text-text-secondary hover:bg-bg-hover'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {setMut.error != null && (
            <p className="text-sm text-red" data-testid="threshold-form-error">
              {(setMut.error as Error).message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => { void submit(); }}
            disabled={setMut.isPending}
            data-testid="threshold-form-submit"
          >
            {setMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
