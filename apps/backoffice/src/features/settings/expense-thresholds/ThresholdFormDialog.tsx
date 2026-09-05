// apps/backoffice/src/features/settings/expense-thresholds/ThresholdFormDialog.tsx
// S28 — wave 5.E — create/edit modal for expense approval thresholds with steps builder.
//
// Native HTML controls kept for form uniformity (this dialog is hand-styled end to end;
// swapping a single field to the @breakery/ui Select primitive would break its internal rhythm).
// Only Button + Dialog* come from @breakery/ui.
import { useState, useEffect } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { Trash2, Plus, Check } from 'lucide-react';
import { useSetExpenseThreshold } from './hooks/useSetExpenseThreshold.js';
import type { ApprovalStep, ExpenseThresholdRow } from './hooks/useExpenseThresholds.js';
import { FOCUS_RING } from '@/components/focusRing.js';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ExpenseThresholdRow | null;
  categories: { id: string; name: string }[];
}

const ROLE_OPTIONS = ['CASHIER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const;

const LABEL_CLS = 'font-data font-semibold text-xs uppercase tracking-widest text-text-secondary';
// `border-border-strong` : bordure de CHAMP = objet graphique, seuil 3:1
// (WCAG 1.4.11). Les bordures de BLOC de ce dialogue restent en `subtle`.
const INPUT_CLS  = `h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary placeholder:text-text-muted ${FOCUS_RING}`;
const SELECT_CLS = `h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;

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
            <label htmlFor="threshold-category" className={LABEL_CLS}>Category</label>
            <select
              id="threshold-category"
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
              <label htmlFor="threshold-amount-min" className={LABEL_CLS}>Amount min (IDR)</label>
              <input
                id="threshold-amount-min"
                type="number"
                className={INPUT_CLS}
                value={amountMin}
                min={0}
                onChange={(e) => setAmountMin(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label htmlFor="threshold-amount-max" className={LABEL_CLS}>Amount max (IDR, exclusive)</label>
              <input
                id="threshold-amount-max"
                type="number"
                className={INPUT_CLS}
                value={amountMax}
                min={0}
                onChange={(e) => setAmountMax(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Approval steps builder */}
          <div>
            <div className="flex justify-between items-center mb-2">
              {/* `<label>` orphelin : il ne désigne aucun contrôle, c'est le
                  titre du constructeur d'étapes. Un `<label>` sans `for` ni
                  contrôle imbriqué est du HTML invalide. */}
              <span className={LABEL_CLS}>Approval steps</span>
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
                    aria-label={`Label for step ${idx + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeStep(idx)}
                    className="flex-shrink-0 p-1 rounded hover:bg-surface-4 text-text-secondary"
                    aria-label={`Remove step ${idx + 1}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {/* Puces de rôle — un groupe de bascules, pas des boutons d'action.
                  *
                  * `aria-pressed` porte l'état coché : sans lui le DOM ne disait
                  * NULLE PART quels rôles sont sélectionnés (ni role, ni
                  * aria-checked) et un lecteur d'écran annonçait quatre boutons
                  * identiques — WCAG 4.1.2, niveau A.
                  *
                  * L'état visuel est porté par le LISERÉ, pas par le fond : les
                  * deux fonds d'origine (gold-soft composé sur blanc = #efebe4
                  * contre l'inerte #fafaf8) ne valaient que 1,137:1, et les deux
                  * textes 1,251:1. Le liseré or vaut 6,22:1 contre la feuille
                  * blanche et 5,95:1 contre le fond de la puce voisine — les 3:1
                  * de WCAG 1.4.11 sont clos des deux côtés du trait.
                  *
                  * Un remplissage encre aurait mieux contrasté encore (16,52:1)
                  * mais aurait posé jusqu'à quatre aplats encre par étape dans
                  * une modale qui en a déjà un sur « Save » : c'est exactement
                  * The One Ink Fill Rule. Le coche redonde la couleur par une
                  * forme (WCAG 1.4.1) et reste en place, invisible, à l'état
                  * décoché — la puce ne change donc pas de largeur en basculant. */}
                <div className="flex flex-wrap gap-1">
                  {ROLE_OPTIONS.map((role) => {
                    const isOn = step.role_codes.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={isOn}
                        onClick={() => toggleStepRole(idx, role)}
                        className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
                          isOn
                            // The Ink-Not-Gold Rule : liseré or + coche + graisse
                            // portent l'état, l'aplat n'ajoutait rien.
                            ? 'border-gold font-semibold text-gold'
                            : 'border-border-subtle bg-surface-inert text-text-muted hover:bg-surface-4'
                        }`}
                      >
                        <Check aria-hidden="true" className={`h-3 w-3 ${isOn ? '' : 'invisible'}`} />
                        {role}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {setMut.error != null && (
            <p className="text-sm text-red" data-testid="threshold-form-error">
              {(setMut.error).message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="ink"
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
