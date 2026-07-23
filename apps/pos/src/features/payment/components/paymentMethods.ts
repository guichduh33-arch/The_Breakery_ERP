// apps/pos/src/features/payment/components/paymentMethods.ts
import {
  ArrowRightLeft, Banknote, CreditCard, QrCode, Smartphone, Wallet,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import type { PaymentMethod } from '@breakery/domain';

export type IconComponent = ForwardRefExoticComponent<
  Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>
>;

export interface MethodMeta {
  value: PaymentMethod;
  label: string;
  icon:  IconComponent;
}

export const METHODS: MethodMeta[] = [
  { value: 'cash',         label: 'Cash',         icon: Banknote },
  { value: 'card',         label: 'Card',         icon: CreditCard },
  { value: 'qris',         label: 'QRIS',         icon: QrCode },
  { value: 'edc',          label: 'EDC',          icon: Smartphone },
  { value: 'transfer',     label: 'Transfer',     icon: ArrowRightLeft },
  { value: 'store_credit', label: 'Store Credit', icon: Wallet },
];

// ADR-006 déc. 9 (payment methods enrichis, lot A) — the BO-configured order
// of `enabled_payment_methods` drives the POS display order, so grids look
// methods up by value instead of filtering this constant.
export const METHODS_BY_VALUE: ReadonlyMap<PaymentMethod, MethodMeta> =
  new Map(METHODS.map((m) => [m.value, m]));
