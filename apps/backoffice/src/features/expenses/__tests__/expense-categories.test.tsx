import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpenseCategoriesTab } from '../components/ExpenseCategoriesTab.js';
import { parseExpenseCategories, type ExpenseCategoriesAdminData } from '../hooks/useExpenseCategoriesAdmin.js';

const { rpc, permission } = vi.hoisted(() => ({ rpc: vi.fn(), permission: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (select: (s: { hasPermission: typeof permission }) => unknown) => select({ hasPermission: permission }),
}));
const data: ExpenseCategoriesAdminData = {
  categories: [{ id: 'cat', code: 'RENT', name: 'Rent', description: 'Monthly rent',
    account_id: 'a', account_code: '6130', account_name: 'Rental', is_active: false, is_used: true }],
  accounts: [{ id: 'a', code: '6130', name: 'Rental' }, { id: 'b', code: '6140', name: 'Utilities' }],
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ExpenseCategoriesTab /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  rpc.mockReset();
  permission.mockReturnValue(true);
  rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'get_expense_categories_admin_v1' ? data : null, error: null }));
});
describe('expense categories management', () => {
  it('shows inactive categories and account names without exposing edit controls to readers', async () => {
    permission.mockReturnValue(false);
    mount();
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('6130 — Rental')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Rent' })).not.toBeInTheDocument();
  });
  it('locks used account and code, saves description/status and invalidates selectors', async () => {
    const client = mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Rent' }));
    expect(screen.getByLabelText(/^Code/)).toBeDisabled();
    expect(screen.getByLabelText(/^Expense account/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('update_expense_category_v1', {
      p_category_id: 'cat', p_name: 'Rent', p_account_id: 'a', p_description: 'Updated', p_is_active: true,
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense-categories'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense-categories-admin'] });
  });
  it('creates with trimmed code and name and no empty description', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'New category' }));
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: ' POWER ' } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: ' Electricity ' } });
    fireEvent.change(screen.getByLabelText(/^Expense account/), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_expense_category_v1', {
      p_code: 'POWER', p_name: 'Electricity', p_account_id: 'b', p_description: null, p_is_active: true,
    }));
  });
  it('keeps the form open when a concurrent expense locks the selected account', async () => {
    rpc.mockImplementation((name: string) => Promise.resolve(name === 'get_expense_categories_admin_v1'
      ? { data: { ...data, categories: [{ ...data.categories[0], is_used: false }] }, error: null }
      : { data: null, error: { message: 'expense_category_account_in_use' } }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Rent' }));
    fireEvent.change(screen.getByLabelText(/^Expense account/), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('expense_category_account_in_use');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('shows failed reads as an error rather than an empty catalog', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(screen.queryByText('No expense categories.')).not.toBeInTheDocument();
  });
  it('rejects malformed boundary payloads', () => {
    expect(() => parseExpenseCategories({ categories: [], accounts: [{ id: 1 }] })).toThrow('Invalid expense categories response.');
    expect(() => parseExpenseCategories({ ...data, categories: [{ ...data.categories[0], is_used: null }] })).toThrow();
    expect(parseExpenseCategories(data)).toEqual(data);
  });
});
