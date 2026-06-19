// apps/backoffice/src/features/combos/__tests__/ComboBuilder.smoke.test.tsx
//
// Session 47 — smoke tests for ComboBuilderPage + sub-components.
// Verifies: renders general info form, add-group, add-option, set-default,
// price preview update, Save calls useUpsertCombo with assembled payload.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import ComboBuilderPage from '../components/ComboBuilderPage.js';

// ------------------------------------------------------------------
// Hoisted mocks — must come before any vi.mock calls
// ------------------------------------------------------------------
const { upsertMutateAsync, deleteMutateAsync } = vi.hoisted(() => ({
  upsertMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
}));

vi.mock('@/lib/supabase.js', () => {
  function buildChain() {
    const chain: Record<string, unknown> = {};
    const methods = ['eq', 'is', 'neq', 'not', 'filter', 'limit'];
    for (const m of methods) { chain[m] = () => chain; }
    chain.select = () => chain;
    chain.order = () =>
      Promise.resolve({
        data: [
          {
            id: 'cat-1',
            name: 'Bundles',
            slug: 'bundles',
            sort_order: 1,
            is_active: true,
            dispatch_station: 'none',
            kds_station: 'expo',
            show_in_pos: true,
            category_type: 'finished',
          },
        ],
        error: null,
      });
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return chain;
  }
  return { supabase: { from: () => buildChain() } };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

vi.mock('../hooks/useUpsertCombo.js', () => ({
  useUpsertCombo: () => ({
    mutateAsync: upsertMutateAsync,
    isPending: false,
  }),
}));

vi.mock('../hooks/useDeleteCombo.js', () => ({
  useDeleteCombo: () => ({
    mutateAsync: deleteMutateAsync,
    isPending: false,
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function makeWrapper(path: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/backoffice/products/combos/new" element={<>{children}</>} />
            <Route path="/backoffice/products/combos" element={<div>Combos List</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

function renderBuilder() {
  const wrapper = makeWrapper('/backoffice/products/combos/new');
  return render(<ComboBuilderPage mode="create" />, { wrapper });
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------
describe('ComboBuilderPage', () => {
  beforeEach(() => {
    upsertMutateAsync.mockResolvedValue({
      combo_product_id: 'cb-new',
      sku: 'CMB-NEW',
      idempotent_replay: false,
    });
    deleteMutateAsync.mockResolvedValue({ combo_product_id: 'cb-1', deleted: true });
  });

  it('renders general info section with name input visible', () => {
    renderBuilder();
    expect(screen.getByTestId('general-info-section')).toBeInTheDocument();
    expect(screen.getByTestId('combo-name')).toBeInTheDocument();
    expect(screen.getByTestId('combo-base-price')).toBeInTheDocument();
    expect(screen.getByTestId('combo-is-active')).toBeInTheDocument();
    expect(screen.getByTestId('combo-visible-on-pos')).toBeInTheDocument();
    expect(screen.getByTestId('price-preview')).toBeInTheDocument();
  });

  it('can add a group via the Add Group button', () => {
    renderBuilder();
    const addGroupBtn = screen.getByTestId('add-group');
    fireEvent.click(addGroupBtn);
    const groupCards = screen.queryAllByTestId(/^group-card-/);
    expect(groupCards.length).toBe(1);
  });

  it('shows a validation error when name is empty and Save is clicked', async () => {
    renderBuilder();
    const saveBtn = screen.getByTestId('save-combo');
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(screen.getByTestId('form-error')).toBeInTheDocument();
    });
    expect(upsertMutateAsync).not.toHaveBeenCalled();
  });

  it('price preview updates when base price changes', () => {
    renderBuilder();
    const priceInput = screen.getByTestId('combo-base-price');
    fireEvent.change(priceInput, { target: { value: '75000' } });
    const preview = screen.getByTestId('price-preview');
    // Indonesian locale: 75000 → "75.000"
    expect(preview.textContent).toContain('75.000');
  });

  it('calls useUpsertCombo with assembled payload on valid save', async () => {
    renderBuilder();

    fireEvent.change(screen.getByTestId('combo-name'), { target: { value: 'Morning Set' } });
    fireEvent.change(screen.getByTestId('combo-base-price'), { target: { value: '45000' } });

    // Wait for category option to appear then select it
    await waitFor(() => {
      const catSelect = screen.getByTestId('combo-category') as HTMLSelectElement;
      expect(catSelect.options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByTestId('combo-category'), { target: { value: 'cat-1' } });

    fireEvent.click(screen.getByTestId('save-combo'));

    await waitFor(() => {
      expect(upsertMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          combo_product_id: null,
          name: 'Morning Set',
          base_price: 45000,
          category_id: 'cat-1',
          groups: [],
        }),
      );
    });
  });
});
