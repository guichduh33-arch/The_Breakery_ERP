// packages/ui/src/components/RefundReceiptModal.tsx
// Session 10 — post-refund / post-void confirmation modal.
// Mirrors SuccessModal pattern but with REFUND header (gold-on-red accent),
// shows refund_number, refunded total, and the per-tender restoration breakdown.

import type { JSX } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Currency } from './Currency.js';
import { Button } from '../primitives/Button.js';
import { FullScreenModal } from './FullScreenModal.js';
import { TenderRow, type TenderRowMethod } from './TenderRow.js';

export interface RefundReceiptTender {
  method: TenderRowMethod;
  amount: number;
}

export interface RefundReceiptModalProps {
  open: boolean;
  refundNumber: string;
  orderNumber: string;
  totalRefunded: number;
  /** Tenders that received the refund (mirror of refund_payments). */
  tenders: RefundReceiptTender[];
  /** True if the source action was a full void (vs partial refund). */
  isFullVoid: boolean;
  onClose: () => void;
}

export function RefundReceiptModal({
  open,
  refundNumber,
  orderNumber,
  totalRefunded,
  tenders,
  isFullVoid,
  onClose,
}: RefundReceiptModalProps): JSX.Element {
  return (
    <FullScreenModal open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <div className="flex flex-col items-center justify-center min-h-screen bg-bg-base">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-red-400/30 bg-bg-elevated px-12 py-10">
          <div className="rounded-full bg-red-500/10 p-3">
            <CheckCircle2 className="h-12 w-12 text-red-400" aria-hidden />
          </div>
          <div className="text-xs uppercase tracking-widest text-text-secondary">
            {isFullVoid ? 'Order Voided' : 'Refund Issued'}
          </div>
          <div className="font-serif text-3xl text-gold">{refundNumber}</div>
          <div className="text-xs text-text-secondary">on order {orderNumber}</div>

          <div className="mt-4 text-center">
            <div className="text-xs uppercase tracking-widest text-text-secondary mb-1">
              Total Refunded
            </div>
            <Currency amount={totalRefunded} emphasis="gold" className="text-4xl" />
          </div>

          {tenders.length > 0 && (
            <div className="w-full mt-4 space-y-2">
              <div className="text-xs uppercase tracking-widest text-text-secondary">
                Restored to
              </div>
              {tenders.map((t, i) => (
                <TenderRow key={`${t.method}-${i}`} method={t.method} amount={t.amount} />
              ))}
            </div>
          )}

          <Button variant="primary" size="lg" className="mt-6 w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
