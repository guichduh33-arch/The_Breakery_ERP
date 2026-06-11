// apps/pos/src/features/payment/split/SplitPaymentFlow.tsx
//
// Session 14 / Phase 2.C — Split-payment orchestrator (refs 90-95).
// Session 38 / Wave C — extended with mode_select, equal, and custom modes.
//
// State machine :
//
//   mode_select → payer_count → assign_items → per_payer_method → [per_payer_cash] → process
//                              ↳ (equal mode: skip assign_items)
//                              ↳ (custom mode: custom_amounts → per_payer_method)
//
// Outputs :
//   onCancel()                                     — close the split flow
//   onComplete(tenders: Tender[])                  — parent ships tenders to
//                                                    checkout RPC. One tender
//                                                    per payer (consolidates
//                                                    `confirmed` payers).
//
// Validation : the cashier must assign EVERY cart unit (items mode) OR all
// amounts must sum to the grand total (equal/custom modes) before proceeding.
// Each payer must confirm before the flow completes.

import { useCallback, useMemo, useState, type JSX } from 'react';
import { ArrowLeft, Users, X } from 'lucide-react';
import { Button, cn } from '@breakery/ui';
import type { CartItem, Tender } from '@breakery/domain';
import { splitEqualAmounts } from '@breakery/domain';
import { ModeSelectStep } from './ModeSelectStep';
import { PayerCountStep } from './PayerCountStep';
import { ItemAssignStep, payerSubtotal } from './ItemAssignStep';
import { CustomAmountsStep } from './CustomAmountsStep';
import { PerPayerMethodStep } from './PerPayerMethodStep';
import { PerPayerCashStep } from './PerPayerCashStep';
import { makePayers, type SplitMode, type SplitPayer, type SplitStep } from './types';

export interface SplitPaymentFlowProps {
  cartItems: readonly CartItem[];
  grandTotal: number;
  /** Close the flow without paying. */
  onCancel: () => void;
  /** Final commit — parent ships these tenders through `complete_order_with_payment`. */
  onComplete: (tenders: Tender[]) => void;
}

/**
 * Helper: compute the effective subtotal for a payer.
 * Equal/custom modes use `assignedAmount`; items mode uses item-based calculation.
 */
function effectiveSubtotal(payer: SplitPayer, cartItems: readonly CartItem[]): number {
  if (payer.assignedAmount !== undefined) return payer.assignedAmount;
  return payerSubtotal(payer, cartItems);
}

export function SplitPaymentFlow({
  cartItems,
  grandTotal,
  onCancel,
  onComplete,
}: SplitPaymentFlowProps): JSX.Element {
  const [step, setStep] = useState<SplitStep>('mode_select');
  const [mode, setMode] = useState<SplitMode>('items');
  const [payerCount, setPayerCount] = useState<number | null>(null);
  const [payers, setPayers] = useState<SplitPayer[]>([]);
  const [activePayerId, setActivePayerId] = useState<string>('');

  // ─── Derived ────────────────────────────────────────────────────────────
  const totalCartUnits = useMemo(
    () => cartItems.reduce((s, i) => s + i.quantity, 0),
    [cartItems],
  );
  const assignedUnits = useMemo(
    () => payers.reduce((s, p) => s + p.items.reduce((acc, a) => acc + a.quantity, 0), 0),
    [payers],
  );
  const allAssigned = assignedUnits === totalCartUnits && totalCartUnits > 0;
  const allConfirmed = payers.length > 0 && payers.every((p) => p.confirmed);

  // ─── Step 0 : select split mode ────────────────────────────────────────
  const handleSelectMode = useCallback((selectedMode: SplitMode) => {
    setMode(selectedMode);
    setStep('payer_count');
  }, []);

  // ─── Step 1 : pick count ───────────────────────────────────────────────
  const handlePickCount = useCallback((count: number, currentMode: SplitMode) => {
    setPayerCount(count);
    const fresh = makePayers(count);

    if (currentMode === 'equal') {
      // Pre-assign equal amounts directly — skip assign_items
      const amounts = splitEqualAmounts(grandTotal, count);
      const withAmounts = fresh.map((p, i) => ({ ...p, assignedAmount: amounts[i]! }));
      setPayers(withAmounts);
      setActivePayerId(withAmounts[0]!.id);
      setStep('per_payer_method');
    } else if (currentMode === 'custom') {
      setPayers(fresh);
      setActivePayerId(fresh[0]!.id);
      setStep('custom_amounts');
    } else {
      // items mode — original flow
      setPayers(fresh);
      setActivePayerId(fresh[0]!.id);
      setStep('assign_items');
    }
  }, [grandTotal]);

  // ─── Step 2 (custom mode) : amounts confirmed ──────────────────────────
  const handleCustomAmountsContinue = useCallback((amounts: number[]) => {
    setPayers((prev) =>
      prev.map((p, i) => ({ ...p, assignedAmount: amounts[i]! })),
    );
    setStep('per_payer_method');
  }, []);

  // ─── Step 2 (items mode) : assign items ───────────────────────────────
  const handleAssign = useCallback((cartItemId: string) => {
    setPayers((prev) => prev.map((p) => {
      if (p.id !== activePayerId) return p;
      const existing = p.items.find((a) => a.cartItemId === cartItemId);
      const items = existing
        ? p.items.map((a) => a.cartItemId === cartItemId ? { ...a, quantity: a.quantity + 1 } : a)
        : [...p.items, { cartItemId, quantity: 1 }];
      return { ...p, items };
    }));
  }, [activePayerId]);

  const handleUnassign = useCallback((cartItemId: string, payerId: string) => {
    setPayers((prev) => prev.map((p) => {
      if (p.id !== payerId) return p;
      const items = p.items
        .map((a) => a.cartItemId === cartItemId ? { ...a, quantity: a.quantity - 1 } : a)
        .filter((a) => a.quantity > 0);
      return { ...p, items };
    }));
  }, []);

  const handleAddPayer = useCallback(() => {
    setPayers((prev) => {
      const idx = prev.length + 1;
      const id = `client-${idx}`;
      const colors = ['blue', 'green', 'orange', 'purple', 'pink'] as const;
      const color = colors[(idx - 1) % colors.length]!;
      return [
        ...prev,
        { id, label: `Client ${idx}`, color, items: [], method: null, cashReceivedStr: '', confirmed: false },
      ];
    });
    setPayerCount((c) => (c ?? 0) + 1);
  }, []);

  // ─── Step 3 / 4 : per-payer method & cash ──────────────────────────────
  const handlePickMethod = useCallback((payerId: string, method: SplitPayer['method']) => {
    setPayers((prev) => prev.map((p) => (p.id === payerId ? { ...p, method, cashReceivedStr: '' } : p)));
    if (method === 'cash') {
      setStep('per_payer_cash');
    }
  }, []);

  const handleCashChange = useCallback((payerId: string, value: string) => {
    setPayers((prev) => prev.map((p) => (p.id === payerId ? { ...p, cashReceivedStr: value } : p)));
  }, []);

  const handleConfirmPayer = useCallback((payerId: string) => {
    setPayers((prev) => prev.map((p) => (p.id === payerId ? { ...p, confirmed: true } : p)));

    // Auto-jump to the next unconfirmed payer if any ; otherwise stay (parent
    // will react to allConfirmed and trigger onComplete).
    setActivePayerId((current) => {
      const idx = payers.findIndex((p) => p.id === current);
      const nextUnconfirmed = payers
        .slice(idx + 1)
        .concat(payers.slice(0, idx))
        .find((p) => !p.confirmed && p.id !== payerId);
      return nextUnconfirmed?.id ?? current;
    });

    // If just confirmed and was on cash step, go back to method picker for next payer.
    if (step === 'per_payer_cash') {
      setStep('per_payer_method');
    }
  }, [payers, step]);

  // ─── Finalize : build tenders + ship ───────────────────────────────────
  const handleProcessAll = useCallback(() => {
    const tenders: Tender[] = payers.map((p) => {
      const amount = effectiveSubtotal(p, cartItems);
      const base: Tender = { method: p.method!, amount };
      if (p.method === 'cash') {
        const received = Number(p.cashReceivedStr || amount);
        const change = Math.max(0, received - amount);
        return {
          ...base,
          cash_received: received,
          ...(change > 0 ? { change_given: change } : {}),
        };
      }
      return base;
    });
    onComplete(tenders);
  }, [payers, cartItems, onComplete]);

  // ─── Back navigation ────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    switch (step) {
      case 'payer_count':
        setStep('mode_select');
        break;
      case 'custom_amounts':
        setStep('payer_count');
        break;
      case 'assign_items':
        setStep('payer_count');
        break;
      case 'per_payer_method':
        if (mode === 'custom') setStep('custom_amounts');
        else if (mode === 'equal') setStep('payer_count');
        else setStep('assign_items');
        break;
      case 'per_payer_cash':
        setStep('per_payer_method');
        break;
      default:
        break;
    }
  }, [step, mode]);

  // ─── Header (per ref 90 / 91 / 94 / 95) ────────────────────────────────
  const headerLabel = useMemo<string>(() => {
    switch (step) {
      case 'mode_select':      return 'Split payment';
      case 'payer_count':      return 'Split payment';
      case 'custom_amounts':   return 'Custom amounts';
      case 'assign_items':     return 'Assign items to payers';
      case 'per_payer_method':
      case 'per_payer_cash':   return 'Split payment — per payer';
    }
  }, [step]);

  // ─── Footer bar (varies per step) ──────────────────────────────────────
  const footer = useMemo(() => {
    if (step === 'assign_items') {
      return (
        <div className="h-16 px-6 flex items-center justify-between border-t border-border-subtle bg-bg-elevated">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden /> Back
          </Button>
          <div className="text-xs text-text-secondary">
            {assignedUnits}/{totalCartUnits} items assigned
          </div>
          <Button
            variant="gold"
            size="lg"
            className="uppercase tracking-widest"
            disabled={!allAssigned}
            onClick={() => setStep('per_payer_method')}
            data-testid="split-proceed-to-payment"
          >
            → Proceed to Payment
          </Button>
        </div>
      );
    }
    if (step === 'per_payer_method' || step === 'per_payer_cash') {
      return (
        <div className="h-16 px-6 flex items-center justify-between border-t border-border-subtle bg-bg-elevated">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden /> Back
          </Button>
          <Button
            variant="gold"
            size="lg"
            className="uppercase tracking-widest"
            disabled={!allConfirmed}
            onClick={handleProcessAll}
            data-testid="split-finalize-all"
          >
            Finalize all payments
          </Button>
        </div>
      );
    }
    return null;
  }, [step, assignedUnits, totalCartUnits, allAssigned, allConfirmed, handleProcessAll, handleBack]);

  return (
    <div className="absolute inset-0 z-30 bg-bg-base flex flex-col" data-testid="split-payment-flow">
      {/* Header */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-3">
          <span className="font-display text-base text-text-primary">The Breakery</span>
          <span className="text-text-secondary text-xs uppercase tracking-widest">Terminal</span>
          <span className="h-4 w-px bg-border-subtle" aria-hidden />
          <span className={cn(
            'inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest',
            'text-gold',
          )}>
            <Users className="h-3.5 w-3.5" aria-hidden />
            {headerLabel}
          </span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Cancel split" onClick={onCancel}>
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      {/* Body */}
      {step === 'mode_select' && (
        <ModeSelectStep onSelect={handleSelectMode} />
      )}
      {step === 'payer_count' && (
        <PayerCountStep value={payerCount} onPick={(count) => handlePickCount(count, mode)} />
      )}
      {step === 'custom_amounts' && (
        <CustomAmountsStep
          payers={payers}
          grandTotal={grandTotal}
          onContinue={handleCustomAmountsContinue}
          onBack={handleBack}
        />
      )}
      {step === 'assign_items' && (
        <ItemAssignStep
          cartItems={cartItems}
          payers={payers}
          activePayerId={activePayerId}
          grandTotal={grandTotal}
          onSetActivePayer={setActivePayerId}
          onAddPayer={handleAddPayer}
          onAssign={handleAssign}
          onUnassign={handleUnassign}
        />
      )}
      {step === 'per_payer_method' && (
        <PerPayerMethodStep
          payers={payers}
          cartItems={cartItems}
          grandTotal={grandTotal}
          activePayerId={activePayerId}
          mode={mode}
          onSetActivePayer={setActivePayerId}
          onPickMethod={handlePickMethod}
          onConfirmPayer={handleConfirmPayer}
        />
      )}
      {step === 'per_payer_cash' && (
        <PerPayerCashStep
          payers={payers}
          cartItems={cartItems}
          grandTotal={grandTotal}
          activePayerId={activePayerId}
          mode={mode}
          onSetActivePayer={setActivePayerId}
          onCashChange={handleCashChange}
          onConfirmPayer={handleConfirmPayer}
          onBackToMethod={() => setStep('per_payer_method')}
        />
      )}

      {/* Footer */}
      {footer}
    </div>
  );
}
