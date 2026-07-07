// apps/backoffice/src/features/accounting/components/RecordCashMovementModal.tsx
// Cash Wallets module — modal to record a manual cash movement (posts a balanced JE).
// Native <select> kept (shared `inputCls` with the hand-styled inputs) so every
// control in this modal stays visually uniform; the @breakery/ui Select primitive
// would introduce a lone 44px field among them.
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useRecordCashMovement, type CashMovementType } from '../hooks/useRecordCashMovement.js';

const TYPES: { value: CashMovementType; label: string; needsWallet?: boolean; requiresAdjust?: boolean }[] = [
  { value: 'undepo_to_petty',   label: 'Transfer Undeposited → Petty Cash' },
  { value: 'petty_to_undepo',   label: 'Return Petty Cash → Undeposited' },
  { value: 'bank_deposit',      label: 'Bank deposit' },
  { value: 'boss_withdrawal',   label: 'Boss withdrawal',                  requiresAdjust: true },
  { value: 'small_money_lend',  label: 'Small Money lends to Undeposited' },
  { value: 'small_money_repay', label: 'Repay Small Money' },
  { value: 'adjustment_gain',   label: 'Adjustment — count overage',       needsWallet: true, requiresAdjust: true },
  { value: 'adjustment_loss',   label: 'Adjustment — count shortage',      needsWallet: true, requiresAdjust: true },
];

const ADJUST_TYPES = new Set<CashMovementType>(['adjustment_gain', 'adjustment_loss', 'boss_withdrawal']);
const DEFAULT_TYPE: CashMovementType = 'undepo_to_petty';

const todayISO = () => new Date().toISOString().slice(0, 10);
const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

export function RecordCashMovementModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const canAdjust = useAuthStore((s) => s.hasPermission('accounting.cash.adjust'));

  const [type, setType]     = useState<CashMovementType>(DEFAULT_TYPE);
  const [amount, setAmount] = useState('');
  const [date, setDate]     = useState(todayISO());
  const [remark, setRemark] = useState('');
  const [wallet, setWallet] = useState<'1110' | '1111' | '1117'>('1110');
  const mut                 = useRecordCashMovement();

  // Reset to a permitted default if the current selection is gated and perm is lost.
  useEffect(() => {
    if (!canAdjust && ADJUST_TYPES.has(type)) {
      setType(DEFAULT_TYPE);
    }
  }, [canAdjust, type]);

  const visibleTypes = TYPES.filter((t) => !t.requiresAdjust || canAdjust);
  const needsWallet = TYPES.find((t) => t.value === type)?.needsWallet ?? false;
  const amt = Number(amount);
  const valid = amt > 0 && (!needsWallet || remark.trim().length > 0);

  const submit = () => {
    if (!valid) return;
    mut.mutate(
      {
        movementType: type,
        amount: amt,
        movementDate: date,
        remark: remark.trim(),
        walletCode: needsWallet ? wallet : null,
      },
      {
        onSuccess: () => {
          setAmount('');
          setRemark('');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New cash movement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            Type
            <select
              className={inputCls}
              value={type}
              onChange={(e) => setType(e.target.value as CashMovementType)}
            >
              {visibleTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          {needsWallet && (
            <label className="block text-sm">
              Wallet
              <select
                className={inputCls}
                value={wallet}
                onChange={(e) => setWallet(e.target.value as '1110' | '1111' | '1117')}
              >
                <option value="1110">Undeposited Funds</option>
                <option value="1111">Petty Cash</option>
                <option value="1117">Small Money</option>
              </select>
            </label>
          )}

          <label className="block text-sm">
            Amount (IDR)
            <input
              className={inputCls}
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            Date
            <input
              className={inputCls}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            Remark{needsWallet ? ' (reason — required)' : ''}
            <input
              className={inputCls}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </label>

          {mut.isError && (
            <p className="text-sm text-destructive">{(mut.error).message}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={!valid || mut.isPending}>
              {mut.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
