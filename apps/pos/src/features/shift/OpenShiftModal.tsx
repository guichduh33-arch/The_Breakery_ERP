// apps/pos/src/features/shift/OpenShiftModal.tsx
//
// Session 14 / Phase 2.C — Multi-step shift open modal.
//
// Three visual states per refs 11-13 :
//   1. PIN  (ref 11) — "Open a Shift / Enter your PIN to open your shift",
//                      6-dot indicator + virtual numpad. Verifies via the
//                      injected `verifyPin` (PinPad-style EF). PIN entry
//                      is optional ; if no verifyPin prop, the step is
//                      skipped automatically. The visual step still fires
//                      for cashiers (D-1 task — security review).
//   2. CASH (ref 12) — APRIL 29, 2026 header, BrandMark "B", OPENING CASH
//                      field, a Numpad to type any float, QUICK AMOUNTS grid
//                      of presets, optional notes. Layout matches the
//                      screenshot — empty state "Rp 0" in gold below the input
//                      box. (Audit esthétique 2026-07-08 batch 3 — the Numpad
//                      was missing: the opening float could only be *picked*
//                      from a preset, never typed, so any non-preset amount was
//                      unenterable. Mirrors CloseShiftModal's Numpad entry.)
//   3. CASH-filled (ref 13) — Same as #2 but with a value bound — the gold
//                      "OPEN SHIFT" CTA at the bottom is enabled and the
//                      Open Shift mutation fires.
//
// The PIN step is purely visual when there's no `verifyPin` prop, but
// keeping it as a default-on step preserves the screenshot intent (the
// cashier sees a "confirm your identity" gate before booking cash).

import { useMemo, useState } from 'react';
import { Lock, X, Clock } from 'lucide-react';
import {
  BrandMark,
  Button,
  Currency,
  FullScreenModal,
  Numpad,
  NumpadVirtual,
  SectionLabel,
  Select,
  cn,
} from '@breakery/ui';
import { todayIsoDate, formatTimeWita } from '@breakery/utils';
import { sumDenominations } from '@breakery/domain';
import { toast } from 'sonner';
import { useOpenShift } from './hooks/useShift';
import { useLanDevices } from './hooks/useLanDevices';
import { useDenominationCountEnabled } from './hooks/useDenominationCountEnabled';
import { DenominationGrid } from './components/DenominationGrid';
import { usePOSPresets } from '@/features/settings/hooks/usePOSPresets';

type Step = 'pin' | 'cash';

export interface OpenShiftModalProps {
  open: boolean;
  /**
   * Optional PIN verifier — when present, step 1 (PIN) gates the cash
   * step on a successful PIN. When omitted, the PIN step still appears
   * (per ref 11) but accepts any 6-digit PIN (S58: aligned with the
   * project-wide exactly-6 rule, was a stale "4-6" lenient check).
   * Default behaviour kept lenient so the existing seed/dev flow continues
   * to work without extra wiring.
   */
  verifyPin?: (pin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Optional close handler — when omitted, the modal cannot be dismissed
   * (used when shift is required to proceed). */
  onClose?: () => void;
}

/** Format a date like "APRIL 29, 2026" (uppercase, locale-agnostic). */
function formatHeaderDate(d: Date): string {
  const month = d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month} ${day}, ${year}`;
}

export function OpenShiftModal({ open, verifyPin, onClose }: OpenShiftModalProps) {
  const [step, setStep] = useState<Step>('pin');
  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  // S67 (12 D2.3) — opt-in denomination grid, mirrors CloseShiftModal.
  const [denoms, setDenoms] = useState<Record<string, number>>({});
  const denomEnabled = useDenominationCountEnabled();

  const STORAGE_KEY = 'pos:last_terminal_id';
  const [terminalId, setTerminalId] = useState<string | null>(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null),
  );
  const lanDevices = useLanDevices({ deviceType: 'pos' });

  const openShift = useOpenShift();
  const { presets } = usePOSPresets();
  const quickAmounts = presets.openingCashPresets;

  const amount = denomEnabled ? sumDenominations(denoms) : Number(amountStr || '0');
  const headerDate = useMemo(() => formatHeaderDate(new Date()), []);
  const headerTime = useMemo(() => formatTimeWita(new Date()), []);
  // todayIsoDate kept for backwards compat with prior subtitle (no longer rendered)
  void todayIsoDate;

  async function handlePinSubmit(pin: string): Promise<void> {
    setPinError(null);
    if (pin.length !== 6) {
      setPinError('PIN must be 6 digits.');
      return;
    }
    if (!verifyPin) {
      // No verifier provided → optimistic pass (matches existing UX).
      setStep('cash');
      return;
    }
    setPinLoading(true);
    try {
      const result = await verifyPin(pin);
      if (result.ok) {
        setStep('cash');
      } else {
        setPinError(
          result.error === 'wrong_pin'
            ? 'Wrong PIN. Try again.'
            : result.error === 'rate_limited'
              ? 'Too many attempts. Wait a moment.'
              : 'Verification failed.',
        );
      }
    } catch {
      setPinError('Network error. Try again.');
    } finally {
      setPinLoading(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    if (amount <= 0) return;
    try {
      const mutInput: {
        opening_cash: number;
        opening_notes?: string;
        terminal_id?: string | null;
        opening_denominations?: Record<string, number>;
      } = { opening_cash: amount };
      if (notes) mutInput.opening_notes = notes;
      if (terminalId) mutInput.terminal_id = terminalId;
      if (denomEnabled) mutInput.opening_denominations = denoms;
      await openShift.mutateAsync(mutInput);
      toast.success('Shift opened');
      // Reset internal state for next mount.
      setStep('pin');
      setAmountStr('');
      setNotes('');
      setDenoms({});
    } catch (err) {
      toast.error('Failed to open shift');
      console.error(err);
    }
  }

  function handleQuickAmount(q: number): void {
    setAmountStr(String(q));
  }

  function handleClose(): void {
    if (onClose) {
      setStep('pin');
      setAmountStr('');
      setNotes('');
      setPinError(null);
      setDenoms({});
      onClose();
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && handleClose()} accessibleTitle="Open shift">
      <div
        className="m-auto bg-bg-overlay rounded-2xl border border-border-subtle shadow-modal w-full max-w-md p-8 space-y-6 max-h-[90dvh] overflow-y-auto"
        data-testid="open-shift-modal"
        data-step={step}
      >
        {/* Header — same chrome across both steps */}
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {step === 'pin' ? (
              <>
                <span className="h-10 w-10 grid place-items-center rounded-md bg-gold-soft">
                  <Lock className="h-5 w-5 text-gold" aria-hidden />
                </span>
                <div>
                  <h2 className="font-display text-xl text-text-primary">Open a Shift</h2>
                  <p className="text-text-secondary text-xs">Enter your PIN to open your shift</p>
                </div>
              </>
            ) : (
              <>
                <BrandMark size="md" />
                <SectionLabel as="h2" size="sm" className="text-text-primary">
                  Open Shift
                </SectionLabel>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 'cash' && (
              <div className="text-right text-xs">
                <div className="font-semibold text-text-primary tracking-wide">{headerDate}</div>
                <div className="text-text-secondary">{headerTime}</div>
              </div>
            )}
            {onClose && (
              <button
                type="button"
                aria-label="Close"
                onClick={handleClose}
                className="h-11 w-11 grid place-items-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </header>

        {/* Step 1 — PIN */}
        {step === 'pin' && (
          <div className="space-y-6">
            <NumpadVirtual
              mode="pin"
              maxLength={6}
              autoSubmitAtMaxLength
              isLoading={pinLoading}
              error={pinError}
              onSubmit={(p) => { void handlePinSubmit(p); }}
              {...(onClose ? { onCancel: handleClose } : {})}
              submitLabel="Verify"
              cancelLabel="Cancel"
            />
          </div>
        )}

        {/* Step 2 — Cash */}
        {step === 'cash' && (
          <div className="space-y-5">
            {denomEnabled ? (
              <section className="space-y-2">
                <SectionLabel as="div">Opening Cash — count by denomination</SectionLabel>
                <DenominationGrid value={denoms} onChange={setDenoms} />
                <div className="text-center pt-1">
                  <Currency amount={amount} emphasis="gold" className="text-2xl font-display" />
                </div>
              </section>
            ) : (
            <>
            <section className="space-y-2">
              <SectionLabel as="div">Opening Cash</SectionLabel>
              <div
                className={cn(
                  'bg-bg-input border-2 rounded-md px-4 py-3 flex items-center justify-between gap-3 transition-colors',
                  amount > 0 ? 'border-gold' : 'border-gold/60',
                )}
              >
                <span className="text-text-secondary text-sm font-mono">Rp</span>
                <span className="text-2xl font-mono tabular-nums text-text-primary text-right flex-1">
                  {amountStr || ' '}
                </span>
              </div>
              <div className="text-center pt-1">
                <Currency
                  amount={amount}
                  emphasis="gold"
                  className="text-2xl font-display"
                />
              </div>
            </section>

            {/* Type any opening float (audit batch 3). Digit-only, IDR has no
                cents — mirrors CloseShiftModal's controlled Numpad. */}
            <Numpad value={amountStr} onChange={setAmountStr} />

            <section className="space-y-2">
              <SectionLabel as="div">Quick Amounts</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {quickAmounts.map((q) => {
                  const selected = amount === q;
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => handleQuickAmount(q)}
                      className={cn(
                        'rounded-md py-2 text-xs font-mono tabular-nums border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                        selected
                          ? 'border-gold bg-gold-soft text-gold'
                          : 'bg-bg-input border-border-subtle text-text-primary hover:bg-bg-overlay',
                      )}
                    >
                      <Currency amount={q} />
                    </button>
                  );
                })}
              </div>
            </section>
            </>
            )}

            <section className="space-y-2">
              <SectionLabel as="div">Terminal (optional)</SectionLabel>
              <Select
                value={terminalId ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setTerminalId(v);
                  if (typeof localStorage !== 'undefined') {
                    if (v) localStorage.setItem(STORAGE_KEY, v);
                    else localStorage.removeItem(STORAGE_KEY);
                  }
                }}
                data-testid="shift-terminal"
              >
                <option value="">(no terminal selected)</option>
                {lanDevices.data?.map((d) => (
                  <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
                ))}
              </Select>
            </section>

            <section className="space-y-2">
              <SectionLabel as="div">Notes (optional)</SectionLabel>
              <textarea
                className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold resize-none"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
              />
            </section>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="ghost"
                size="md"
                className="w-full uppercase tracking-widest text-text-secondary"
                onClick={onClose ? handleClose : () => setStep('pin')}
                data-testid="open-shift-cancel"
              >
                Cancel
              </Button>
              <Button
                variant="gold"
                size="lg"
                className="w-full uppercase tracking-widest"
                disabled={amount <= 0 || openShift.isPending}
                onClick={() => { void handleSubmit(); }}
                data-testid="open-shift-submit"
              >
                <span className="inline-flex items-center gap-2">
                  <Clock className="h-4 w-4" aria-hidden />
                  {openShift.isPending ? 'Opening…' : 'Open Shift'}
                </span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </FullScreenModal>
  );
}
