// apps/pos/src/features/payment/SuccessModal.tsx
import { useEffect, useRef, useState } from 'react';
import { Check, Printer, RotateCw } from 'lucide-react';
import { Button, Currency, FullScreenModal } from '@breakery/ui';
import { calculateTotals, DEFAULT_TAX_RATE } from '@breakery/domain';
import type { Cart, PaymentMethod } from '@breakery/domain';
import { printReceipt, openCashDrawer, type ReceiptPayload } from '@/services/print/printService';
import { useStationPrinters } from '@/features/cart/hooks/useStationPrinters';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { toast } from 'sonner';

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
  /**
   * Session 37 B3 — real loyalty balance after the sale, as returned by the
   * RPC (loyalty_transactions.points_balance_after). When absent (the v10 RPC
   * envelope does not expose it — deferred to v11), the `balance_after` field
   * is OMITTED from the receipt rather than rendered as 0.
   */
  loyaltyBalanceAfter?: number;
  customerName?: string;
  cart: Cart;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  cashierName: string;
  onNewOrder: () => void;
}

function buildReceiptPayload(props: SuccessModalProps): ReceiptPayload {
  const totals = calculateTotals(props.cart, DEFAULT_TAX_RATE);
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
      loyalty: {
        points_earned: props.pointsEarned,
        // Only include balance_after when the caller provides the real value.
        // Omitting it (rather than rendering 0) avoids misleading the customer
        // until the v11 RPC exposes loyalty_transactions.points_balance_after.
        ...(props.loyaltyBalanceAfter !== undefined
          ? { balance_after: props.loyaltyBalanceAfter }
          : {}),
      },
    } : {}),
    footer: 'Thank you!',
  };
}

export function SuccessModal(props: SuccessModalProps) {
  const { open, orderNumber, total, changeGiven, pointsEarned, customerName, onNewOrder } = props;
  const [isPrinting, setIsPrinting] = useState(false);
  // Guards the mount-effect side effects (toast) against firing after the modal
  // has unmounted — e.g. the cashier hits "New Order" before the print/drawer
  // bridge responds. Firing a toast on a dead component is wrong in prod and
  // also leaks across test boundaries under load.
  const mountedRef = useRef(true);
  const { data: printers } = useStationPrinters();
  const cashierPrinter = printers?.get('cashier');
  const autoPrint = usePosSettingsStore((s) => s.autoPrint);
  const autoOpenDrawer = usePosSettingsStore((s) => s.autoOpenDrawer);

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
    mountedRef.current = true;
    if (!open) return;
    void (async () => {
      // Only attempt (and therefore only warn about) the drawer when the
      // autoOpenDrawer setting is on. Card/QRIS still wouldn't warn because of
      // the method gate below, but a disabled setting must also skip the pop.
      const drawerTask = autoOpenDrawer
        ? openCashDrawer()
        : Promise.resolve({ success: true } as const);
      const printTask = autoPrint ? handlePrint() : Promise.resolve();
      const [drawer] = await Promise.all([drawerTask, printTask]);
      if (!mountedRef.current) return;
      // Cash-gated at the call-site: openCashDrawer() takes no argument and
      // cannot know the method, so card/QRIS would otherwise produce a false
      // "drawer didn't open" warning. Only cash payments expect a drawer pop,
      // and only when autoOpenDrawer actually attempted to open it.
      if (autoOpenDrawer && props.paymentMethod === 'cash' && !drawer.success) {
        toast.warning('Cash drawer did not open — please open it manually');
      }
    })();
    return () => { mountedRef.current = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FullScreenModal open={open} onOpenChange={() => { /* must click action */ }} accessibleTitle="Payment successful">
      <div
        className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal text-center space-y-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300"
        data-testid="receipt-success"
      >
        <div className="grid place-items-center">
          <div className="h-16 w-16 rounded-full bg-green-soft border-2 border-green grid place-items-center motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500">
            <Check className="h-8 w-8 text-green" strokeWidth={3} aria-hidden />
          </div>
        </div>
        <div className="space-y-1">
          <h2 className="font-serif text-2xl">Payment successful!</h2>
          <p className="text-text-secondary text-sm">Order completed · {orderNumber}</p>
          {customerName && <p className="text-text-secondary text-xs">{customerName}</p>}
        </div>
        <div className="space-y-4">
          {/* Change to give — the #1 operational number on this screen (cashier
              reads it to hand back cash). Hero treatment when there's change due;
              omitted entirely for card/QRIS where changeGiven is null/0. */}
          {changeGiven !== null && changeGiven > 0 && (
            <div
              className="rounded-lg border border-gold/40 bg-gold-soft px-4 py-4"
              data-testid="success-change-block"
            >
              <div className="text-[11px] uppercase tracking-widest text-text-secondary mb-1">
                Change to give
              </div>
              <Currency
                amount={changeGiven}
                emphasis="gold"
                className="block font-mono tabular-nums text-4xl font-bold tracking-tight"
              />
            </div>
          )}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Total</span>
              <Currency amount={total} emphasis="gold" />
            </div>
            {pointsEarned !== undefined && pointsEarned > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Points earned</span>
                <span className="font-mono text-gold font-semibold">+{pointsEarned} pts</span>
              </div>
            )}
          </div>
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
