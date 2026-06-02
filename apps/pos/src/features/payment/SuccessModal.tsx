// apps/pos/src/features/payment/SuccessModal.tsx
import { useEffect, useState } from 'react';
import { Check, Printer, RotateCw } from 'lucide-react';
import { Button, Currency, FullScreenModal } from '@breakery/ui';
import { calculateTotals } from '@breakery/domain';
import type { Cart, PaymentMethod } from '@breakery/domain';
import { printReceipt, openCashDrawer, type ReceiptPayload } from '@/services/print/printService';
import { useStationPrinters } from '@/features/cart/hooks/useStationPrinters';
import { toast } from 'sonner';

const TAX_RATE = 0.10;
const BUSINESS = {
  name: 'The Breakery',
  address: 'Jl. Contoh No. 1, Jakarta',
  phone: '+62-21-000000',
};

export interface SuccessModalProps {
  open: boolean;
  orderNumber: string;
  total: number;
  changeGiven: number | null;
  pointsEarned?: number;
  customerName?: string;
  cart: Cart;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  cashierName: string;
  onNewOrder: () => void;
}

function buildReceiptPayload(props: SuccessModalProps): ReceiptPayload {
  const totals = calculateTotals(props.cart, TAX_RATE);
  return {
    business: BUSINESS,
    order: {
      order_number: props.orderNumber,
      created_at: new Date().toISOString(),
      cashier_name: props.cashierName,
      order_type: props.cart.order_type === 'dine_in' ? 'dine_in' : 'take_out',
    },
    ...(props.customerName ? { customer: { name: props.customerName } } : {}),
    items: props.cart.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      ...(item.modifiers.length > 0 ? {
        modifiers: item.modifiers.map((m) => ({ label: m.option_label, price_adjustment: m.price_adjustment })),
      } : {}),
      line_total: (item.unit_price + item.modifiers.reduce((s, m) => s + m.price_adjustment, 0)) * item.quantity,
    })),
    totals: {
      items_total: totals.subtotal,
      redemption_amount: totals.redemption_amount,
      total: totals.total,
      tax_amount: totals.tax_amount,
    },
    payment: {
      method: props.paymentMethod,
      amount: props.total,
      ...(props.paymentMethod === 'cash'
        ? { cash_received: props.cashReceived, change_given: props.changeGiven ?? 0 }
        : {}),
    },
    ...(props.pointsEarned && props.pointsEarned > 0 ? {
      loyalty: { points_earned: props.pointsEarned, balance_after: 0 },
    } : {}),
    footer: 'Thank you!',
  };
}

export function SuccessModal(props: SuccessModalProps) {
  const { open, orderNumber, total, changeGiven, pointsEarned, customerName, onNewOrder } = props;
  const [isPrinting, setIsPrinting] = useState(false);
  const { data: printers } = useStationPrinters();
  const cashierPrinter = printers?.get('cashier');

  async function handlePrint() {
    setIsPrinting(true);
    const payload = buildReceiptPayload(props);
    const result = await printReceipt(payload, cashierPrinter);
    if (!result.success) {
      toast.warning('Print server unreachable — receipt not printed');
    }
    setIsPrinting(false);
  }

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [, drawer] = await Promise.all([handlePrint(), openCashDrawer()]);
      // Cash-gated at the call-site: openCashDrawer() takes no argument and
      // cannot know the method, so card/QRIS would otherwise produce a false
      // "drawer didn't open" warning. Only cash payments expect a drawer pop.
      if (props.paymentMethod === 'cash' && !drawer.success) {
        toast.warning('Cash drawer did not open — please open it manually');
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FullScreenModal open={open} onOpenChange={() => { /* must click action */ }}>
      <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal text-center space-y-6" data-testid="receipt-success">
        <div className="grid place-items-center">
          <div className="h-16 w-16 rounded-full bg-green-soft border-2 border-green grid place-items-center">
            <Check className="h-8 w-8 text-green" strokeWidth={3} aria-hidden />
          </div>
        </div>
        <div className="space-y-1">
          <h2 className="font-serif text-2xl">Payment successful!</h2>
          <p className="text-text-secondary text-sm">Order completed · {orderNumber}</p>
          {customerName && <p className="text-text-secondary text-xs">{customerName}</p>}
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
          {pointsEarned !== undefined && pointsEarned > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Points earned</span>
              <span className="font-mono text-gold font-semibold">+{pointsEarned} pts</span>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={() => { void handlePrint(); }}
            disabled={isPrinting}
          >
            <Printer className="h-4 w-4 mr-2" aria-hidden /> Reprint
          </Button>
          <Button variant="gold" size="lg" className="flex-1" onClick={onNewOrder}>
            <RotateCw className="h-4 w-4 mr-2" aria-hidden /> New Order
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
