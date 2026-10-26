import { attachCustomer, detachCustomer, calculateTotals, type CartItem } from '@breakery/domain';
import type { CartState, CustomerWithCategory } from './cartTypes';
import { reconcilePromotions } from './cartPromotions';

export type CustomerPricingSnapshot = Pick<CartState,
 'cart'|'attachedCustomer'|'lockedItemIds'|'printedItemIds'|'pickedUpOrderId'|'offlineOrder'|'orderSnapshotVersion'>;
export function captureCustomerPricing(state: CustomerPricingSnapshot): CustomerPricingSnapshot {
 const {cart,attachedCustomer,lockedItemIds,printedItemIds,pickedUpOrderId,offlineOrder,orderSnapshotVersion}=state;
 return {cart,attachedCustomer,lockedItemIds,printedItemIds,pickedUpOrderId,offlineOrder,orderSnapshotVersion};
}
export function sameCustomerPricingContext(state: CustomerPricingSnapshot, expected: CustomerPricingSnapshot): boolean {
 return state.cart===expected.cart && state.attachedCustomer===expected.attachedCustomer
  && state.lockedItemIds===expected.lockedItemIds && state.printedItemIds===expected.printedItemIds
  && state.pickedUpOrderId===expected.pickedUpOrderId && state.offlineOrder===expected.offlineOrder
  && state.orderSnapshotVersion===expected.orderSnapshotVersion;
}
export function isLocalPriceEditable(state: CustomerPricingSnapshot,item: CartItem): boolean {
 return !item.server_id && item.server_line_total===undefined && !item.is_cancelled && !item.is_promo_gift
  && item.product_type!=='combo' && !item.combo_components && !state.lockedItemIds.includes(item.id) && !state.printedItemIds.includes(item.id);
}
export function customerPricingPatch(state: CartState,expected: CustomerPricingSnapshot,
 customer: CustomerWithCategory|null,prices: ReadonlyMap<string,number>): Partial<CartState>|null {
 if(!sameCustomerPricingContext(state,expected))return null;
 const items=state.cart.items.map(item=>{
  if(!isLocalPriceEditable(state,item))return item;
  const price=prices.get(item.product_id);
  if(price===undefined || !Number.isFinite(price) || price<0)throw new Error('The product prices could not be confirmed.');
  return item.unit_price===price?item:{...item,unit_price:price};
 });
 let cart={...state.cart,items};
 // Changer de personne compose les gestes existants détacher/rattacher : aucun rachat de l'ancien client ne suit.
 if(!customer || state.cart.customerId!==customer.id)cart=detachCustomer(cart);
 if(customer)cart=attachCustomer(cart,customer.id);
 // Les anciennes conditions promotionnelles ne voyagent pas vers le nouveau client.
 const {patch}=reconcilePromotions({...state,cart},[]);
 const result={...patch,attachedCustomer:customer};
 calculateTotals(result.cart??cart,0);
 return result;
}
