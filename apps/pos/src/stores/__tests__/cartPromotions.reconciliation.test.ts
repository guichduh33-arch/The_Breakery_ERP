import { beforeEach, describe, expect, it } from 'vitest';
import type { AppliedPromotion, CartItem } from '@breakery/domain';
import { useCartStore } from '../cartStore';

const gift = (id='gift-promo', extra: Partial<CartItem>={}): CartItem => ({
 id, product_id:'old', name:'Old gift', quantity:1, unit_price:0, modifiers:[],
 is_promo_gift:true, promotion_id:'promo', ...extra,
});
const promo=(qty:number,product_id='old'):AppliedPromotion[]=>[{
 promotion_id:'promo',slug:'promo',name:'Gift',type:'free_product',amount:0,description:'',
 gift_to_add:{product_id,qty},
}];
const lookup={'old':{name:'Old gift'},'new':{name:'New gift'}};
beforeEach(()=>useCartStore.setState({
 cart:{order_type:'take_out',items:[gift()]},lockedItemIds:[],printedItemIds:[],appliedPromotions:[],
}));
describe('réconciliation des cadeaux locaux',()=>{
 it('met à jour la quantité puis conserve la référence pour une réponse identique',()=>{
  useCartStore.getState().setAppliedPromotions(promo(3),lookup);
  expect(useCartStore.getState().cart.items[0]?.quantity).toBe(3);
  const stable=useCartStore.getState().cart;
  useCartStore.getState().setAppliedPromotions(promo(3),lookup);
  expect(useCartStore.getState().cart).toBe(stable);
 });
 it('change le SKU local et retire les anciens modificateurs',()=>{
  useCartStore.setState({cart:{order_type:'take_out',items:[gift('gift-promo',{modifiers:[{group_name:'fixture',option_label:'old',price_adjustment:5000}]})]}});
  useCartStore.getState().setAppliedPromotions(promo(2,'new'),lookup);
  expect(useCartStore.getState().cart.items[0]).toMatchObject({product_id:'new',quantity:2,name:'New gift',modifiers:[]});
 });
 it('préserve chaque fait envoyé et ne crée que le reste de la quantité totale',()=>{
  const fixed=[gift('server',{server_id:'db'}),gift('locked'),gift('printed'),gift('cancelled',{is_cancelled:true})];
  useCartStore.setState({cart:{order_type:'take_out',items:[...fixed,gift()]},lockedItemIds:['locked'],printedItemIds:['printed']});
  useCartStore.getState().setAppliedPromotions(promo(5),lookup);
  const items=useCartStore.getState().cart.items;
  fixed.forEach((item,index)=>expect(items[index]).toBe(item));
  expect(items.at(-1)?.quantity).toBe(2);
  useCartStore.getState().setAppliedPromotions([],lookup);
  expect(useCartStore.getState().cart.items).toEqual(fixed);
 });
 it('élimine les doublons locaux et garde des identifiants uniques face à un ancien cadeau annulé',()=>{
  const cancelled=gift('gift-promo',{is_cancelled:true});
  useCartStore.setState({cart:{order_type:'take_out',items:[cancelled]}});
  useCartStore.getState().setAppliedPromotions(promo(1),lookup);
  const items=useCartStore.getState().cart.items;
  expect(items[0]).toBe(cancelled);
  expect(new Set(items.map(x=>x.id)).size).toBe(2);
  useCartStore.setState(s=>({cart:{...s.cart,items:[...s.cart.items,gift('duplicate')]}}));
  useCartStore.getState().setAppliedPromotions(promo(2),lookup);
  expect(useCartStore.getState().cart.items.filter(x=>!x.is_cancelled)).toHaveLength(1);
 });
});
