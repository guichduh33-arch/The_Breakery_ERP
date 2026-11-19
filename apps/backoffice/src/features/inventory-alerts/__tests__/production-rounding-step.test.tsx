// S3-09 — l'onglet des suggestions lit la v5, affiche le pas métier et le règle.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const rpc = vi.fn<(fn: string, args?: unknown) => Promise<unknown>>();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (fn: string, args?: unknown) => rpc(fn, args) },
}));

let canUpdate = true;
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p) => p !== 'products.update' || canUpdate }),
}));

import { ProductionAlertsTab } from '../components/ProductionAlertsTab.js';
import { parseProductionSuggestion } from '../hooks/useProductionSuggestions.js';

const ROW = {
  product_id: 'p-1',
  product_name: 'Butter Croissant',
  product_sku: 'CRO-1',
  current_stock: 0,
  avg_daily_sales: 5.71,
  days_of_stock: 0,
  suggested_quantity: 24,
  production_rounding_step: 12,
  priority: 'high',
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  canUpdate = true;
});

describe('ProductionAlertsTab — batch step (S3-09)', () => {
  it('reads get_production_suggestions_v5 and shows the rounded quantity and the step', async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    wrap(<ProductionAlertsTab />);
    expect(await screen.findByText('Butter Croissant')).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('get_production_suggestions_v5', {});
    expect(screen.getByRole('columnheader', { name: 'Batch step' })).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows a dash when the product has no step', async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, production_rounding_step: null, suggested_quantity: 17 }], error: null });
    wrap(<ProductionAlertsTab />);
    expect(await screen.findByText('17')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('saves a new step through set_production_rounding_step_v1', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === 'get_production_suggestions_v5' ? { data: [ROW], error: null } : { data: {}, error: null }),
    );
    wrap(<ProductionAlertsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit production step for Butter Croissant' }));
    const input = screen.getByRole('spinbutton', { name: 'Production step for Butter Croissant' });
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_production_rounding_step_v1', { p_product_id: 'p-1', p_step: 10 }),
    );
  });

  it('clears the step when the field is emptied', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === 'get_production_suggestions_v5' ? { data: [ROW], error: null } : { data: {}, error: null }),
    );
    wrap(<ProductionAlertsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit production step for Butter Croissant' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_production_rounding_step_v1', { p_product_id: 'p-1', p_step: null }),
    );
  });

  it('shows the server refusal in English', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'get_production_suggestions_v5'
          ? { data: [ROW], error: null }
          : { data: null, error: { message: 'permission_denied' } },
      ),
    );
    wrap(<ProductionAlertsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit production step for Butter Croissant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to change this product.');
  });

  it('hides the edit control without products.update', async () => {
    canUpdate = false;
    rpc.mockResolvedValue({ data: [ROW], error: null });
    wrap(<ProductionAlertsTab />);
    expect(await screen.findByText('Butter Croissant')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit production step/ })).toBeNull();
  });

  it('drops malformed rows and keeps numeric strings as numbers', () => {
    expect(parseProductionSuggestion({ product_name: 'x' })).toBeNull();
    expect(parseProductionSuggestion({ ...ROW, production_rounding_step: '12.000' })?.production_rounding_step).toBe(12);
  });
});
