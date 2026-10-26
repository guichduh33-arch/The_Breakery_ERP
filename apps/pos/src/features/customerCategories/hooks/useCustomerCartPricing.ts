import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useCartStore, type CustomerWithCategory } from '@/stores/cartStore';
import { captureCustomerPricing, isLocalPriceEditable } from '@/stores/cartCustomerPricing';
import { isCartPaymentLocked } from '@/stores/cartPaymentGuard';
import { useCustomerProductPrice } from './useCustomerProductPrice';

export type CustomerChangeResult = {status:'applied'|'ignored'} | {status:'error'; message:string};
export function useCustomerCartPricing() {
 const profile=useAuthStore(s=>s.user?.id),token=useAuthStore(s=>s.sessionToken),locked=useAuthStore(s=>s.isLocked);
 const shiftId=useShiftStore(s=>s.current?.id);
 const fetchPrice=useCustomerProductPrice();
 const [busy,setBusy]=useState(false);
 const request=useRef(0),mounted=useRef(true);
 useEffect(()=>{request.current++;setBusy(false);},[profile,token,locked,shiftId]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const cancel=useCallback(()=>{request.current++;if(mounted.current)setBusy(false);},[]);
 const change=useCallback(async(customer:CustomerWithCategory|null):Promise<CustomerChangeResult>=>{
  const generation=++request.current,auth=useAuthStore.getState(),shift=useShiftStore.getState().current?.id;
  const expected=captureCustomerPricing(useCartStore.getState());
  const current=()=>{
   const now=useAuthStore.getState();
   return mounted.current && generation===request.current && Boolean(auth.user?.id && auth.sessionToken)
    && now.user?.id===auth.user?.id && now.sessionToken===auth.sessionToken && now.isAuthenticated
    && !now.isLoading && !now.isLocked && useShiftStore.getState().current?.id===shift;
  };
  if(!current())return {status:'ignored'};
  if(isCartPaymentLocked())return {status:'error',message:'Finish or resume the current order operation before changing its customer.'};
  setBusy(true);
  let quoteConfirmed=false;
  try {
   const ids=[...new Set(expected.cart.items.filter(item=>isLocalPriceEditable(expected,item)).map(item=>item.product_id))];
   const prices=new Map(await Promise.all(ids.map(async id=>[id,await fetchPrice(id,customer?.id??null)] as const)));
   if(!current())return {status:'ignored'};
   quoteConfirmed=true;
   const account=useAuthStore.getState();
   if(!account.hasPermission('customers.read') && !account.hasPermission('pos.sale.create'))throw new Error('Customer access changed.');
   if(!useCartStore.getState().applyCustomerPrices(expected,customer,prices))return {status:'ignored'};
   return {status:'applied'};
  } catch {
   return current()?{status:'error',message:quoteConfirmed?'The customer change could not be saved. Check the current cart before continuing.':'Prices could not be confirmed. The current customer and cart were kept. Please try again.'}:{status:'ignored'};
  } finally {if(current())setBusy(false);}
 },[fetchPrice]);
 return {change,cancel,busy};
}
