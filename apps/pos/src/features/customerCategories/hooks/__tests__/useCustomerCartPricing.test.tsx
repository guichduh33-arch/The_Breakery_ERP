import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCartStore, type CustomerWithCategory } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useCustomerCartPricing } from '../useCustomerCartPricing';

const {quote,locked}=vi.hoisted(()=>({quote:vi.fn(),locked:{value:false}}));
vi.mock('../useCustomerProductPrice',()=>({useCustomerProductPrice:()=>quote}));
vi.mock('@/stores/cartPaymentGuard',()=>({
 isCartPaymentLocked:()=>locked.value,guardCartActions:<T,>(state:T)=>state,
}));
vi.mock('@/stores/authStore',async()=>{
 const {create}=await import('zustand');
 return {useAuthStore:create(()=>({user:{id:'operator'},sessionToken:'session',isAuthenticated:true,
  isLocked:false,isLoading:false,hasPermission:()=>true}))};
});
const customer=(id:string)=>({id,name:id,loyalty_points:10,lifetime_points:10}) as CustomerWithCategory;
const deferred=()=>{
 let resolve!:(price:number)=>void, reject!:(error:Error)=>void;
 const promise=new Promise<number>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
};
beforeEach(()=>{
 quote.mockReset();locked.value=false;
 useAuthStore.setState({user:{id:'operator',full_name:'Operator',employee_code:'Fixture',role_code:'cashier'},
  sessionToken:'session',isAuthenticated:true,isLoading:false,isLocked:false,hasPermission:()=>true});
 useShiftStore.setState({current:{id:'shift',opened_at:'',opening_cash:0}});
 useCartStore.setState({cart:{order_type:'take_out',customerId:'old',items:[
  {id:'a',product_id:'a',name:'A',unit_price:10000,quantity:1,modifiers:[]},
  {id:'b',product_id:'b',name:'B',unit_price:12000,quantity:1,modifiers:[]},
 ]},attachedCustomer:customer('old'),lockedItemIds:[],printedItemIds:[],pickedUpOrderId:null,
  offlineOrder:null,orderSnapshotVersion:0,appliedPromotions:[]});
});
describe('reprise des prix client',()=>{
 it('ne publie aucun prix ni nouveau client avant la dernière réponse',async()=>{
  const a=deferred(),b=deferred();quote.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const {result}=renderHook(()=>useCustomerCartPricing());const before=useCartStore.getState();
  let request!:ReturnType<typeof result.current.change>;
  act(()=>{request=result.current.change(customer('new'));});
  await act(async()=>{a.resolve(7000);await a.promise;});
  expect(useCartStore.getState().cart).toBe(before.cart);
  expect(result.current.busy).toBe(true);
  await act(async()=>{b.resolve(8000);expect(await request).toEqual({status:'applied'});});
  expect(useCartStore.getState().cart.customerId).toBe('new');
  expect(useCartStore.getState().cart.items.map(x=>x.unit_price)).toEqual([7000,8000]);
  expect(result.current.busy).toBe(false);
 });
 it.each([false,true])('préserve le rattachement CASHIER sans lecture générale (empty=%s)',async empty=>{
  quote.mockResolvedValue(6500);
  useAuthStore.setState({hasPermission:code=>code==='pos.sale.create'});
  if(empty)useCartStore.setState(s=>({cart:{...s.cart,items:[]}}));
  const {result}=renderHook(()=>useCustomerCartPricing());
  await act(async()=>expect(await result.current.change(customer('cashier-client'))).toEqual({status:'applied'}));
  expect(useCartStore.getState().cart.customerId).toBe('cashier-client');
 });
 it('conserve exactement le client et le panier si une résolution échoue',async()=>{
  quote.mockResolvedValueOnce(7000).mockRejectedValueOnce(new Error('WAN'));
  const {result}=renderHook(()=>useCustomerCartPricing());const before=useCartStore.getState();
  await act(async()=>expect(await result.current.change(customer('new'))).toMatchObject({status:'error'}));
  expect(useCartStore.getState().cart).toBe(before.cart);
  expect(useCartStore.getState().attachedCustomer).toBe(before.attachedCustomer);
 });
 it('ignore une ancienne sélection répondant après la suivante',async()=>{
  const old=deferred();quote.mockReturnValueOnce(old.promise).mockReturnValueOnce(old.promise).mockResolvedValue(6000);
  const {result}=renderHook(()=>useCustomerCartPricing());
  let first!:ReturnType<typeof result.current.change>;
  act(()=>{first=result.current.change(customer('first'));});
  await act(async()=>expect(await result.current.change(customer('last'))).toEqual({status:'applied'}));
  await act(async()=>{old.resolve(1000);expect(await first).toEqual({status:'ignored'});});
  expect(useCartStore.getState().cart.customerId).toBe('last');
  expect(useCartStore.getState().cart.items[0]?.unit_price).toBe(6000);
 });
 it.each(['session','profile','shift','cart','print','snapshot','permission','cancel','unmount','payment'] as const)(
  'refuse la réponse après un changement %s',async context=>{
   const pending=deferred();quote.mockReturnValue(pending.promise);
   const {result,unmount}=renderHook(()=>useCustomerCartPricing());
   let request!:ReturnType<typeof result.current.change>;
   act(()=>{request=result.current.change(customer('new'));});
   act(()=>{
    if(context==='session')useAuthStore.setState({sessionToken:'next'});
    if(context==='profile')useAuthStore.setState({user:null});
    if(context==='shift')useShiftStore.setState({current:null});
    if(context==='cart')useCartStore.setState(s=>({cart:{...s.cart,tableNumber:'T2'}}));
    if(context==='print')useCartStore.setState({printedItemIds:['a']});
    if(context==='snapshot')useCartStore.setState({orderSnapshotVersion:1});
    if(context==='permission')useAuthStore.setState({hasPermission:()=>false});
    if(context==='cancel')result.current.cancel();
    if(context==='payment')locked.value=true;
    if(context==='unmount')unmount();
   });
   const current=useCartStore.getState().cart;
   await act(async()=>{pending.resolve(5000);expect((await request).status).not.toBe('applied');});
   expect(useCartStore.getState().cart).toBe(current);
   if(context==='shift')expect(result.current.busy).toBe(false);
  });
});
