import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerWithCategory } from '@/stores/cartStore';
import { CustomerAttachModal } from '../CustomerAttachModal';

const customer={id:'customer',name:'Pricing Customer',loyalty_points:0,lifetime_points:0} as CustomerWithCategory;
describe('sélection client avec résolution de prix',()=>{
 it.each([false,true])('attend la confirmation et ne ferme que si elle est acceptée (%s)',async accepted=>{
  let confirm!:(value:boolean)=>void;
  const pending=new Promise<boolean>(resolve=>{confirm=resolve;});
  const select=vi.fn(()=>pending),close=vi.fn(),search=vi.fn(()=>Promise.resolve([customer]));
  const {rerender}=render(<CustomerAttachModal open onClose={close} onSelect={select} searchFn={search}/>);
  fireEvent.change(screen.getByLabelText('Search customer'),{target:{value:'Pricing'}});
  fireEvent.click(await screen.findByRole('button',{name:/Pricing Customer/}));
  expect(select).toHaveBeenCalledWith(customer);
  expect(close).not.toHaveBeenCalled();
  rerender(<CustomerAttachModal open selecting onClose={close} onSelect={select} searchFn={search}/>);
  expect(screen.getByRole('status').textContent).toContain('Checking customer prices');
  await act(async()=>{confirm(accepted);await pending;});
  await waitFor(()=>expect(close).toHaveBeenCalledTimes(accepted?1:0));
 });
 it('garde une voie de fermeture pendant la résolution',()=>{
  const close=vi.fn();
  render(<CustomerAttachModal open selecting onClose={close} onSelect={()=>false} searchFn={()=>Promise.resolve([])}/>);
  fireEvent.click(screen.getAllByRole('button',{name:'Close'})[0]!);
  expect(close).toHaveBeenCalledTimes(1);
 });
});
