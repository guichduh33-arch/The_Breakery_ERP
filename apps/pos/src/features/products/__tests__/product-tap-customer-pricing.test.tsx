import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCartStore, type CustomerWithCategory } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { ProductTapHandler } from '../ProductTapHandler';

const mocks=vi.hoisted(()=>({
 quote:vi.fn(),error:vi.fn(),groups:[],product:{
 id:'product',sku:'P',name:'Product',category_id:null,retail_price:10000,wholesale_price:null,
 product_type:'finished',image_url:null,current_stock:10,is_active:true,is_favorite:false,
 },
}));
vi.mock('sonner',()=>({toast:{error:mocks.error}}));
vi.mock('../ProductGrid',()=>({
 ProductGrid:({onSelect}:{onSelect:(product:typeof mocks.product)=>void})=><button onClick={()=>onSelect(mocks.product)}>Product</button>,
}));
vi.mock('../hooks/useProductModifiers',()=>({
 useProductModifiers:()=>({isSuccess:true,data:mocks.groups}),
}));
vi.mock('@/features/customerCategories/hooks/useCustomerProductPrice',()=>({useCustomerProductPrice:()=>mocks.quote}));
vi.mock('@/features/combos/components/ComboConfigModal',()=>({ComboConfigModal:()=>null}));
vi.mock('@/features/cart/VariantSelectModal',()=>({VariantSelectModal:()=>null}));
vi.mock('@/stores/authStore',async()=>{
 const {create}=await import('zustand');
 return {useAuthStore:create(()=>({user:{id:'operator'},sessionToken:'session',isAuthenticated:true,
  isLocked:false,isLoading:false,hasPermission:()=>true}))};
});
const deferred=()=>{
 let resolve!:(price:number)=>void,reject!:(error:Error)=>void;
 const promise=new Promise<number>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
};
beforeEach(()=>{
 mocks.quote.mockReset();mocks.error.mockClear();
 useAuthStore.setState({user:{id:'operator',full_name:'Operator',employee_code:'Test',role_code:'cashier'},
 sessionToken:'session',isAuthenticated:true,isLocked:false,isLoading:false,hasPermission:()=>true});
 useShiftStore.setState({current:{id:'shift',opened_at:'',opening_cash:0}});
 useCartStore.setState({cart:{order_type:'take_out',customerId:'client',items:[]},
  attachedCustomer:{id:'client',name:'Client'} as CustomerWithCategory,lockedItemIds:[],printedItemIds:[],
  pickedUpOrderId:null,offlineOrder:null,orderSnapshotVersion:0});
});
describe('prix client lors du tap produit',()=>{
 it('garde deux taps concurrents indépendants au prix confirmé',async()=>{
  const a=deferred(),b=deferred();mocks.quote.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  render(<ProductTapHandler selectedSlug={null}/>);
  fireEvent.click(screen.getByText('Product'));
  await waitFor(()=>expect(mocks.quote).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('Product'));
  await waitFor(()=>expect(mocks.quote).toHaveBeenCalledTimes(2));
  await act(async()=>{b.resolve(7000);await b.promise;});
  await act(async()=>{a.resolve(7000);await a.promise;});
  expect(useCartStore.getState().cart.items.reduce((sum,item)=>sum+item.quantity,0)).toBe(2);
  expect(useCartStore.getState().cart.items[0]?.unit_price).toBe(7000);
 });
 it('autorise le prix client au caissier avec le seul droit de vente',async()=>{
  useAuthStore.setState({hasPermission:code=>code==='pos.sale.create'});
  mocks.quote.mockResolvedValue(7000);
  render(<ProductTapHandler selectedSlug={null}/>);
  fireEvent.click(screen.getByText('Product'));
  await waitFor(()=>expect(useCartStore.getState().cart.items).toHaveLength(1));
  expect(useCartStore.getState().cart.items[0]?.unit_price).toBe(7000);
 });
 it('refuse un prix indisponible sans fallback retail',async()=>{
  mocks.quote.mockRejectedValue(new Error('WAN'));
  render(<ProductTapHandler selectedSlug={null}/>);
  fireEvent.click(screen.getByText('Product'));
  await waitFor(()=>expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('item was not added')));
  expect(useCartStore.getState().cart.items).toHaveLength(0);
 });
 it.each(['customer','session','shift','clear','snapshot','unmount'] as const)('ignore une réponse après %s',async context=>{
  const a=deferred();mocks.quote.mockReturnValue(a.promise);
  const {unmount}=render(<ProductTapHandler selectedSlug={null}/>);
  fireEvent.click(screen.getByText('Product'));
  await waitFor(()=>expect(mocks.quote).toHaveBeenCalledTimes(1));
  act(()=>{
   if(context==='customer')useCartStore.getState().attachCustomer({id:'next',name:'Next'} as CustomerWithCategory);
   if(context==='session')useAuthStore.setState({sessionToken:'next'});
   if(context==='shift')useShiftStore.setState({current:null});
   if(context==='clear')useCartStore.getState().clear();
   if(context==='snapshot')useCartStore.setState({orderSnapshotVersion:1});
   if(context==='unmount')unmount();
  });
  await act(async()=>{a.resolve(7000);await a.promise;});
  expect(useCartStore.getState().cart.items).toHaveLength(0);
 });
 it('continue les taps retail locaux sans résolution réseau',async()=>{
  useCartStore.getState().detachCustomer();
  render(<ProductTapHandler selectedSlug={null}/>);
  fireEvent.click(screen.getByText('Product'));
  await waitFor(()=>expect(useCartStore.getState().cart.items).toHaveLength(1));
  expect(mocks.quote).not.toHaveBeenCalled();
  expect(useCartStore.getState().cart.items[0]?.unit_price).toBe(10000);
 });
});
