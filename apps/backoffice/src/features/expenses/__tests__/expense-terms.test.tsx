import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpenseTermsTab } from '../components/ExpenseTermsTab.js';
import { parseExpenseTerms } from '../hooks/useExpenseTerms.js';
const { rpc, permission } = vi.hoisted(() => ({rpc: vi.fn(), permission: vi.fn()}));
vi.mock('@/lib/supabase.js', () => ({supabase: {rpc}}));
vi.mock('@/stores/authStore.js', () => ({useAuthStore: (select: (s: {hasPermission: typeof permission}) => unknown) => select({hasPermission: permission})}));
vi.mock('../hooks/useExpensesList.js', () => ({useExpenseCategories: () => ({data: [{id: 'cat', name: 'Utilities'}],isLoading: false,isError: false,error: null})}));
const term = {id: 'term',code: 'POWER',name: 'Electricity',category_id: 'cat',category_name: 'Utilities',account_code: '6113',account_name: 'Utilities',is_active: true,is_available: true,is_used: true,aliases: ['PLN','Listrik']};
function mount() {const client = new QueryClient({defaultOptions: {queries: {retry: false},mutations: {retry: false}}});render(<QueryClientProvider client={client}><ExpenseTermsTab /></QueryClientProvider>);return client;}
beforeEach(() => {rpc.mockReset();permission.mockReturnValue(true);rpc.mockImplementation((name: string) => Promise.resolve({data: name === 'get_expense_terms_v1' ? [term] : null,error: null}));});
describe('expense terms management', () => {
  it('rejects malformed responses at the boundary', () => {
    expect(() => parseExpenseTerms([{...term,aliases: [12]}])).toThrow('Invalid expense terms response.');
    expect(() => parseExpenseTerms({terms: [term]})).toThrow();
  });
  it('lets readers search synonyms and inspect the account without edit controls', async () => {
    permission.mockReturnValue(false);mount();
    expect(await screen.findByText('6113 — Utilities')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search terms'), {target: {value: 'PLN'}});
    expect(screen.getByText('Electricity')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'New term'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Edit Electricity'})).not.toBeInTheDocument();
  });
  it('locks the used identity, saves synonyms and refreshes both term queries', async () => {
    const client=mount();const invalidate=vi.spyOn(client,'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', {name: 'Edit Electricity'}));
    expect(await screen.findByLabelText(/^Standard name/)).toBeDisabled();
    expect(screen.getByLabelText(/^Category/)).toBeDisabled();
    expect(screen.getByLabelText(/^Code/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search synonyms'), {target: {value: ' PLN, Power bill '}});
    fireEvent.click(screen.getByRole('button', {name: 'Save term'}));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('save_expense_term_v1', {p_code:'POWER',p_name:'Electricity',p_category_id:'cat',p_aliases:['PLN','Power bill'],p_is_active:true,p_term_id:'term'}));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({queryKey:['expense-terms']}));
  });
  it('keeps a rejected duplicate visible for correction', async () => {
    mount();fireEvent.click(await screen.findByRole('button', {name: 'Edit Electricity'}));
    rpc.mockResolvedValueOnce({data:null,error:{message:'This synonym is already used.'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save term'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('This synonym is already used.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
