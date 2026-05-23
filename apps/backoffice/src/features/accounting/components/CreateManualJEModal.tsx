// apps/backoffice/src/features/accounting/components/CreateManualJEModal.tsx
// Session 26b / Wave 2.C — Manual JE saisie OD modal (2-step stepper).
//   Step 1 : header (description + entry_date)
//   Step 2 : lines table (account picker + debit/credit + balance check + PIN)

import { useMemo, useState, type JSX } from 'react';
import {
  Button, Input,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@breakery/ui';
import { Plus, Trash2 } from 'lucide-react';
import { usePostableAccounts } from '../hooks/usePostableAccounts.js';
import { useCreateManualJournalEntry, type ManualJELine } from '../hooks/useCreateManualJournalEntry.js';

interface DraftLine {
  key:         string;
  account_id:  string;
  debit:       string; // string for input control
  credit:      string;
  description: string;
}

function newDraftLine(): DraftLine {
  return {
    key:         `l${Math.random().toString(36).slice(2)}`,
    account_id:  '',
    debit:       '',
    credit:      '',
    description: '',
  };
}

function fmt(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

export interface CreateManualJEModalProps {
  onClose: () => void;
}

export function CreateManualJEModal({ onClose }: CreateManualJEModalProps): JSX.Element {
  const accounts = usePostableAccounts();
  const createJe = useCreateManualJournalEntry();

  const [step, setStep]                 = useState<1 | 2>(1);
  const [description, setDescription]   = useState('');
  const [entryDate, setEntryDate]       = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines]               = useState<DraftLine[]>([newDraftLine(), newDraftLine()]);
  const [pin, setPin]                   = useState('');
  const [error, setError]               = useState<string | null>(null);

  const totals = useMemo(() => {
    let debit = 0, credit = 0;
    for (const l of lines) {
      debit  += Number(l.debit  || 0);
      credit += Number(l.credit || 0);
    }
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine()   { setLines((prev) => [...prev, newDraftLine()]); }
  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.key !== key)));
  }

  function handleNext() {
    setError(null);
    if (description.trim().length < 3) {
      setError('Description requires at least 3 characters.');
      return;
    }
    if (!entryDate) {
      setError('Entry date is required.');
      return;
    }
    setStep(2);
  }

  function handleSubmit() {
    setError(null);

    // Validate lines client-side before submit
    for (const l of lines) {
      if (l.account_id === '') {
        setError('Each line must have an account.');
        return;
      }
      const dr = Number(l.debit  || 0);
      const cr = Number(l.credit || 0);
      if (dr < 0 || cr < 0) {
        setError('Line amounts cannot be negative.');
        return;
      }
      if ((dr > 0 && cr > 0) || (dr === 0 && cr === 0)) {
        setError('Each line must be either debit XOR credit (not both, not neither).');
        return;
      }
    }
    if (!totals.balanced) {
      setError(`Unbalanced : debit ${fmt(totals.debit)} vs credit ${fmt(totals.credit)}.`);
      return;
    }
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('PIN must be exactly 6 digits.');
      return;
    }

    const rpcLines: ManualJELine[] = lines.map((l) => ({
      account_id: l.account_id,
      ...(Number(l.debit  || 0) > 0 ? { debit:  Number(l.debit) }  : {}),
      ...(Number(l.credit || 0) > 0 ? { credit: Number(l.credit) } : {}),
      ...(l.description.trim() !== '' ? { description: l.description.trim() } : {}),
    }));

    createJe.mutate(
      { description: description.trim(), entry_date: entryDate, lines: rpcLines, manager_pin: pin },
      {
        onSuccess: () => onClose(),
        onError:   (e) => setError(e.message),
      },
    );
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New manual journal entry (OD)</DialogTitle>
          <DialogDescription>
            Step {step} of 2 — {step === 1 ? 'header' : 'lines + PIN'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <label className="flex flex-col text-sm">
              Description
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. April rent payment"
                data-testid="je-modal-description"
              />
            </label>
            <label className="flex flex-col text-sm max-w-xs">
              Entry date
              <Input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                data-testid="je-modal-entry-date"
              />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <table className="w-full text-sm" data-testid="je-modal-lines-table">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-text-secondary border-b border-border-subtle">
                  <th className="px-2 py-2">Account</th>
                  <th className="px-2 py-2 text-right">Debit</th>
                  <th className="px-2 py-2 text-right">Credit</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-t border-border-subtle">
                    <td className="px-2 py-2">
                      <select
                        value={line.account_id}
                        onChange={(e) => updateLine(line.key, { account_id: e.target.value })}
                        className="w-full rounded border border-border-subtle bg-bg-elevated px-2 py-1 text-sm"
                        data-testid={`je-modal-line-account-${line.key}`}
                      >
                        <option value="">— select —</option>
                        {(accounts.data ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.debit}
                        onChange={(e) => updateLine(line.key, { debit: e.target.value })}
                        className="w-28 text-right font-mono"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.credit}
                        onChange={(e) => updateLine(line.key, { credit: e.target.value })}
                        className="w-28 text-right font-mono"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        value={line.description}
                        onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        placeholder="(optional)"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length <= 2}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border-strong font-semibold">
                  <td className="px-2 py-2 text-right">Totals</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(totals.debit)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(totals.credit)}</td>
                  <td className="px-2 py-2 text-xs" data-testid="je-modal-balance-state">
                    {totals.balanced ? (
                      <span className="text-green-700">✓ Balanced</span>
                    ) : (
                      <span className="text-red">
                        ✗ Δ {fmt(Math.abs(totals.debit - totals.credit))}
                      </span>
                    )}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>

            <Button
              variant="ghost"
              size="sm"
              onClick={addLine}
              className="inline-flex items-center gap-1"
              data-testid="je-modal-add-line"
            >
              <Plus className="h-3 w-3" aria-hidden /> Add line
            </Button>

            <label className="flex flex-col text-sm max-w-xs">
              Manager PIN (6 digits)
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                data-testid="je-modal-pin"
              />
            </label>
          </div>
        )}

        {error !== null && (
          <div
            role="alert"
            className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red"
            data-testid="je-modal-error"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={createJe.isPending}>
            Cancel
          </Button>
          {step === 1 && (
            <Button onClick={handleNext} data-testid="je-modal-next">Next →</Button>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={createJe.isPending}>
                ← Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createJe.isPending}
                data-testid="je-modal-submit"
              >
                {createJe.isPending ? 'Posting…' : 'Post entry'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
