import { isOrderSending } from './orderSendGuard';
import type { CartState } from './cartTypes';
import { usePaymentStore } from './paymentStore';
import { toast } from 'sonner';

export function isCartPaymentLocked(): boolean {
  const { attempt, recoveryError } = usePaymentStore.getState();
  return Boolean(isOrderSending() || recoveryError !== null || (attempt && attempt.state !== 'refused'));
}

/** Seules les commandes de saisie sont bloquées ; les accusés serveur peuvent encore être appliqués. */
export function guardCartActions(actions: CartState): CartState {
  const names: (keyof CartState)[] = ['add', 'addCombo', 'update', 'remove', 'restoreLine', 'clear', 'voidOrder', 'setOrderType', 'setTableNumber', 'attachCustomer', 'detachCustomer', 'setRedeemPoints', 'restoreCart', 'reopenOrder', 'setCartDiscount', 'setLineDiscount', 'setAppliedPromotions', 'dismissPromotion'];
  const guarded = Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => {
    if (isCartPaymentLocked()) {
      if (name !== 'setAppliedPromotions') toast.error(isOrderSending() ? 'Sending order — wait for confirmation before changing it' : 'Resume the saved payment before changing this order');
      return name === 'setAppliedPromotions' ? { addedGifts: [], removedGifts: [] } : undefined;
    }
    return Reflect.apply(actions[name] as (...values: unknown[]) => unknown, actions, args);
  }]));
  return { ...actions, ...guarded };
}
