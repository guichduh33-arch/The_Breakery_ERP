import { calculateTotals, pointsToValue, type AppliedPromotion, type CartItem } from '@breakery/domain';
import type { CartState } from './cartTypes';
interface GiftChange {name: string; promotion_id: string}
export function reconcilePromotions(state: CartState,next: AppliedPromotion[],productLookup: Record<string,{name:string}> = {}): {
 patch: Partial<CartState>; addedGifts: GiftChange[]; removedGifts: GiftChange[];
} {
 const addedGifts: GiftChange[]=[],removedGifts: GiftChange[]=[];
 const protectedIds=new Set([...state.lockedItemIds,...state.printedItemIds]);
 const protectedLine=(item: CartItem)=>(Boolean(item.server_id) || item.server_line_total!==undefined || item.is_cancelled===true || protectedIds.has(item.id));
 const fixedQuantities=new Map<string,number>();
 for(const item of state.cart.items) {
  if(item.is_promo_gift && item.promotion_id && protectedLine(item) && !item.is_cancelled) {
   fixedQuantities.set(item.promotion_id,(fixedQuantities.get(item.promotion_id)??0)+item.quantity);
  }
 }
 const desired=new Map(next.filter(ap=>ap.gift_to_add).map(ap=>{
  const gift=ap.gift_to_add!;
  if(!Number.isFinite(gift.qty) || gift.qty<0)throw new Error('Invalid promotional gift quantity');
  return [ap.promotion_id,{productId:gift.product_id,quantity:Math.max(0,gift.qty-(fixedQuantities.get(ap.promotion_id)??0)),name:productLookup[gift.product_id]?.name??ap.name}] as const;
 }));
 const consumed=new Set<string>();
 const nextItems: CartItem[]=[];
 for(const item of state.cart.items) {
  if(!item.is_promo_gift || !item.promotion_id || protectedLine(item)) {nextItems.push(item);continue;}
  const gift=desired.get(item.promotion_id);
  if(!gift || gift.quantity===0 || consumed.has(item.promotion_id)) {
   removedGifts.push({name:item.name,promotion_id:item.promotion_id});continue;
  }
  consumed.add(item.promotion_id);
  if(item.product_id!==gift.productId) {
   removedGifts.push({name:item.name,promotion_id:item.promotion_id});
   addedGifts.push({name:gift.name,promotion_id:item.promotion_id});
   nextItems.push({id:item.id,product_id:gift.productId,name:gift.name,quantity:gift.quantity,unit_price:0,modifiers:[],is_promo_gift:true,promotion_id:item.promotion_id});
  } else if(item.quantity!==gift.quantity || item.unit_price!==0 || item.name!==gift.name) {
   nextItems.push({...item,quantity:gift.quantity,unit_price:0,name:gift.name});
  } else nextItems.push(item);
 }
 for(const [promotionId,gift] of desired) {
  if(consumed.has(promotionId) || gift.quantity===0)continue;
  const baseId='gift-'+promotionId;
  const id=nextItems.some(item=>item.id===baseId)?baseId+'-'+crypto.randomUUID():baseId;
  nextItems.push({id,product_id:gift.productId,name:gift.name,unit_price:0,quantity:gift.quantity,modifiers:[],is_promo_gift:true,promotion_id:promotionId});
  addedGifts.push({name:gift.name,promotion_id:promotionId});
 }
 // ADR-013 D11 : pipeline du domaine, puis clamp existant du rachat de points.
 const itemsTotal=calculateTotals({items:nextItems,order_type:state.cart.order_type},0).subtotal;
 const promoTotal=Math.min(next.reduce((sum,ap)=>sum+ap.amount,0),itemsTotal);
 const currentPoints=state.cart.loyaltyPointsToRedeem??0;
 const clampedPoints=currentPoints>0?Math.min(currentPoints,Math.floor((itemsTotal-promoTotal)/pointsToValue(1))):currentPoints;
 const giftsChanged=nextItems.length!==state.cart.items.length || nextItems.some((item,index)=>item!==state.cart.items[index]);
 const changed=giftsChanged || (state.cart.promotionTotal??0)!==promoTotal || clampedPoints!==currentPoints;
 return {patch:{cart:changed?{...state.cart,items:nextItems,promotionTotal:promoTotal,
   ...(clampedPoints!==currentPoints?{loyaltyPointsToRedeem:clampedPoints}:{})}:state.cart,appliedPromotions:next},addedGifts,removedGifts};
}
