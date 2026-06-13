import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMemo, useState, type JSX } from 'react';
import { validateRedeem, pointsToValue } from '@breakery/domain';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { FullScreenModal } from './FullScreenModal.js';
import { Numpad } from './Numpad.js';

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

export interface RedeemPointsModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (points: number) => void;
  customerBalance: number;
  itemsTotal: number;
}

function formatIDR(amount: number): string {
  return amount.toLocaleString('id-ID') + ' IDR';
}

export function RedeemPointsModal({
  open,
  onClose,
  onConfirm,
  customerBalance,
  itemsTotal,
}: RedeemPointsModalProps): JSX.Element {
  const [raw, setRaw] = useState('');

  const points = raw === '' ? 0 : parseInt(raw, 10);
  const value = pointsToValue(points);

  const errors = useMemo(
    () => validateRedeem(points, customerBalance, itemsTotal, true),
    [points, customerBalance, itemsTotal],
  );

  const isValid = points > 0 && errors.length === 0;

  function handleConfirm(): void {
    if (!isValid) return;
    onConfirm(points);
  }

  function handleOpenChange(o: boolean): void {
    if (!o) {
      setRaw('');
      onClose();
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={handleOpenChange} accessibleTitle="Redeem points">
      <DialogPrimitive.Title asChild>
        <span className={cn(SR_ONLY)}>Redeem points</span>
      </DialogPrimitive.Title>
      <DialogPrimitive.Description asChild>
        <span className={cn(SR_ONLY)}>Enter the number of points to redeem.</span>
      </DialogPrimitive.Description>

      <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <div>
          <h2 className="font-serif text-xl">Redeem points</h2>
          <p className="text-xs text-text-secondary">
            Balance: <span className="font-mono font-semibold">{customerBalance.toLocaleString()} pts</span>
          </p>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-1">Points to redeem</p>
          <p className="font-mono text-4xl font-bold text-text-primary" aria-live="polite">
            {points > 0 ? points.toLocaleString() : '—'}
          </p>
          <p className="text-sm text-text-secondary mt-1" aria-live="polite">
            = {value > 0 ? formatIDR(value) : '0 IDR'}
          </p>
        </div>

        {errors.length > 0 && (
          <div className="space-y-1" role="alert">
            {errors.map((e) => (
              <p key={e.code} className="text-red text-sm text-center">
                {e.message}
              </p>
            ))}
          </div>
        )}

        <Numpad value={raw} onChange={setRaw} className="w-full max-w-xs" />
      </div>

      <footer className="px-6 py-4 border-t border-border-subtle bg-bg-elevated flex justify-end gap-3">
        <Button variant="secondary" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={handleConfirm}
          disabled={!isValid}
          aria-disabled={!isValid}
        >
          Confirm
        </Button>
      </footer>
    </FullScreenModal>
  );
}
