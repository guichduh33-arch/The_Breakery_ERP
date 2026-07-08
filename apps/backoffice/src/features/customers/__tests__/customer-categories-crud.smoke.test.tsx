// apps/backoffice/src/features/customers/__tests__/customer-categories-crud.smoke.test.tsx
// S69 Volet A (Task 3) — smoke test for the activated CustomerCategoriesPage
// CRUD (New/Edit/Delete), mirroring the mocking style of
// LanDevicesTable.smoke.test.tsx (module-level authStore mock) and
// RetailCreditLimitSection.smoke.test.tsx (RTL render helpers).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import CustomerCategoriesPage from '@/pages/customers/CustomerCategoriesPage.js';
import * as categoriesMod from '../hooks/useCustomerCategories.js';
import * as mutationsMod from '../hooks/useCustomerCategoryMutations.js';
import type { CustomerCategoryRow } from '../hooks/useCustomerCategories.js';

// Neither the RPC-calling hooks nor the page's real Supabase client are
// exercised (all mutation/query hooks are mocked below) — mocking
// '@/lib/supabase.js' just short-circuits the module's env-var validation
// (parseAppEnv) which otherwise throws under vitest with no VITE_* env set.
vi.mock('@/lib/supabase.js', () => ({ supabase: {} }));

let currentPerms: Record<string, boolean> = {};
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms[p] ?? false }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

type CatsQuery = UseQueryResult<CustomerCategoryRow[], Error>;

function fakeQuery(data: CustomerCategoryRow[], overrides: Partial<CatsQuery> = {}): CatsQuery {
  return { data, isLoading: false, error: null, ...overrides } as unknown as CatsQuery;
}

const ONE_CATEGORY: CustomerCategoryRow = {
  id: 'cat-1',
  name: 'Wholesale',
  slug: 'wholesale',
  color: null,
  icon: null,
  price_modifier_type: 'wholesale',
  discount_percentage: 0,
  loyalty_enabled: true,
  points_multiplier: 1,
  is_default: false,
  is_active: true,
};

function fakeMutation(mutate: ReturnType<typeof vi.fn>): unknown {
  return {
    mutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  };
}

describe('CustomerCategoriesPage CRUD', () => {
  let createMutate: ReturnType<typeof vi.fn>;
  let updateMutate: ReturnType<typeof vi.fn>;
  let deleteMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    currentPerms = {
      'customer_categories.read':   true,
      'customer_categories.create': true,
      'customer_categories.update': true,
      'customer_categories.delete': true,
    };
    vi.spyOn(categoriesMod, 'useCustomerCategories').mockReturnValue(fakeQuery([ONE_CATEGORY]));

    createMutate = vi.fn();
    updateMutate = vi.fn();
    deleteMutate = vi.fn();
    vi.spyOn(mutationsMod, 'useCreateCustomerCategory').mockReturnValue(
      fakeMutation(createMutate) as ReturnType<typeof mutationsMod.useCreateCustomerCategory>,
    );
    vi.spyOn(mutationsMod, 'useUpdateCustomerCategory').mockReturnValue(
      fakeMutation(updateMutate) as ReturnType<typeof mutationsMod.useUpdateCustomerCategory>,
    );
    vi.spyOn(mutationsMod, 'useDeleteCustomerCategory').mockReturnValue(
      fakeMutation(deleteMutate) as ReturnType<typeof mutationsMod.useDeleteCustomerCategory>,
    );
  });

  it('enables New Category with write perm and opens the create modal', () => {
    render(wrap(<CustomerCategoriesPage />));
    const newBtn = screen.getByRole('button', { name: /new category/i });
    expect(newBtn).toBeEnabled();

    fireEvent.click(newBtn);
    expect(screen.getByTestId('category-form-modal')).toBeInTheDocument();
    expect(screen.getByText('New category')).toBeInTheDocument();
  });

  it('disables New Category without customer_categories.create', () => {
    currentPerms['customer_categories.create'] = false;
    render(wrap(<CustomerCategoriesPage />));
    expect(screen.getByRole('button', { name: /new category/i })).toBeDisabled();
  });

  it('opens the edit modal pre-filled with the category values', () => {
    render(wrap(<CustomerCategoriesPage />));
    fireEvent.click(screen.getByRole('button', { name: /edit wholesale/i }));

    expect(screen.getByTestId('category-form-modal')).toBeInTheDocument();
    expect(screen.getByText('Edit category')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Wholesale');
    expect(screen.getByLabelText('Slug')).toHaveValue('wholesale');
  });

  it('triggers the delete mutation on confirm', () => {
    render(wrap(<CustomerCategoriesPage />));
    fireEvent.click(screen.getByRole('button', { name: /delete wholesale/i }));

    expect(screen.getByTestId('delete-category-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-category-confirm'));

    expect(deleteMutate).toHaveBeenCalledWith('cat-1', expect.anything());
  });
});
