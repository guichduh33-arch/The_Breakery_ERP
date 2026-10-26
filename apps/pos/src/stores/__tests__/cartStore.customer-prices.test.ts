import { beforeEach, describe, expect, it } from 'vitest';
import type { CartItem } from '@breakery/domain';
import { useCartStore, type CustomerWithCategory } from '../cartStore';
import { captureCustomerPricing } from '../cartCustomerPricing';

const client = (id: string) => ({ id, name: id, lifetime_points: 0, loyalty_points: 100 }) as CustomerWithCategory;
const line = (id: string, extra: Partial<CartItem> = {}): CartItem => ({
 id, product_id: 'product', name: id, unit_price: 10000, quantity: 1, modifiers: [], ...extra,
});
beforeEach(() => {
 useCartStore.setState({
  cart: { order_type: 'take_out', items: [line('local')], customerId: 'old', loyaltyPointsToRedeem: 10 },
  attachedCustomer: client('old'), lockedItemIds: [], printedItemIds: [], pickedUpOrderId: null,
  offlineOrder: null, orderSnapshotVersion: 0, appliedPromotions: [], dismissedPromotionIds: new Set(),
 });
});

describe('changement atomique de client et de prix', () => {
 it('applique toutes les lignes locales en conservant modificateurs, remises et faits serveur', () => {
  const fixed = [line('server', {server_id:'db'}), line('total', {server_line_total:8000}),
   line('locked'), line('printed'), line('cancelled', {is_cancelled:true}),
   line('combo', {product_type:'combo'})];
  const local = line('local', {discount:{type:'fixed_amount', value:1000, amount:1000, reason:'Fixture discount'}});
  useCartStore.setState(s=>({cart:{...s.cart,items:[local,line('other'),...fixed]},
   lockedItemIds:['locked'],printedItemIds:['printed']}));
  const previous=useCartStore.getState(), expected=captureCustomerPricing(previous);
  expect(previous.applyCustomerPrices(expected,client('new'),new Map([['product',7000]]))).toBe(true);
  const now=useCartStore.getState();
  expect(now.cart.customerId).toBe('new');
  expect(now.attachedCustomer?.id).toBe('new');
  expect(now.cart.items.slice(0,2).map(x=>x.unit_price)).toEqual([7000,7000]);
  expect(now.cart.items[0]?.discount).toBe(local.discount);
  expect(now.cart.items[0]?.modifiers).toBe(local.modifiers);
  fixed.forEach((item,index)=>expect(now.cart.items[index+2]).toBe(item));
  expect(now.cart.loyaltyPointsToRedeem??0).toBe(0);
 });
 it('détache le client et restaure le prix retail confirmé', () => {
  const s=useCartStore.getState();
  s.applyCustomerPrices(captureCustomerPricing(s),null,new Map([['product',12000]]));
  const now=useCartStore.getState();
  expect(now.cart.customerId).toBeUndefined();
  expect(now.attachedCustomer).toBeNull();
  expect(now.cart.items[0]?.unit_price).toBe(12000);
 });
 it.each([undefined, -1, NaN, Infinity])('refuse un ensemble incomplet/invalide %s sans mutation', price => {
  const before=useCartStore.getState();
  const prices = price===undefined ? new Map<string,number>() : new Map([['product',price]]);
  expect(()=>before.applyCustomerPrices(captureCustomerPricing(before),client('new'),prices)).toThrow();
  expect(useCartStore.getState().cart).toBe(before.cart);
  expect(useCartStore.getState().attachedCustomer).toBe(before.attachedCustomer);
 });
 it.each(['cart','lockedItemIds','printedItemIds','orderSnapshotVersion'] as const)('ignore un contexte %s modifié', field => {
  const before=useCartStore.getState(), expected=captureCustomerPricing(before);
  if(field==='cart') useCartStore.setState({cart:{...before.cart,tableNumber:'T1'}});
  else if(field==='orderSnapshotVersion')useCartStore.setState({orderSnapshotVersion:1});
  else useCartStore.setState({[field]:['local']});
  const current=useCartStore.getState();
  expect(current.applyCustomerPrices(expected,client('new'),new Map([['product',6000]]))).toBe(false);
  expect(useCartStore.getState().cart).toBe(current.cart);
 });
});
