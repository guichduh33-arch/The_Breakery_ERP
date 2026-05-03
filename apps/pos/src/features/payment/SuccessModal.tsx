// apps/pos/src/features/payment/SuccessModal.tsx
import { Check, Printer, RotateCw } from 'lucide-react';
import { Button, Currency, FullScreenModal } from '@breakery/ui';

export interface SuccessModalProps {
  open: boolean;
  orderNumber: string;
  total: number;
  changeGiven: number | null;
  onNewOrder: () => void;
  onPrint?: () => void;
}

export function SuccessModal({ open, orderNumber, total, changeGiven, onNewOrder, onPrint }: SuccessModalProps) {
  return (
    <FullScreenModal open={open} onOpenChange={() => { /* must click action */ }}>
      <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal text-center space-y-6">
        <div className="grid place-items-center">
          <div className="h-16 w-16 rounded-full bg-green-soft border-2 border-green grid place-items-center">
            <Check className="h-8 w-8 text-green" strokeWidth={3} aria-hidden />
          </div>
        </div>
        <div className="space-y-1">
          <h2 className="font-serif text-2xl">Payment successful!</h2>
          <p className="text-text-secondary text-sm">Order completed · {orderNumber}</p>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Total</span>
            <Currency amount={total} emphasis="gold" />
          </div>
          {changeGiven !== null && changeGiven > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Change</span>
              <Currency amount={changeGiven} emphasis="gold" />
            </div>
          )}
        </div>
        <div className="flex gap-3">
          {onPrint && (
            <Button variant="secondary" size="lg" className="flex-1" onClick={onPrint}>
              <Printer className="h-4 w-4 mr-2" aria-hidden /> Print
            </Button>
          )}
          <Button variant="gold" size="lg" className="flex-1" onClick={onNewOrder}>
            <RotateCw className="h-4 w-4 mr-2" aria-hidden /> New Order
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
