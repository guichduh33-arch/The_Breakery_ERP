// apps/backoffice/src/__tests__/products-list.smoke.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProductsPage from '@/pages/Products.js';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => Promise.resolve({
            data: [
              { id: '1', sku: 'BEV-AMER', name: 'Americano', category_id: 'c1', retail_price: 35000, tax_inclusive: true, image_url: null, current_stock: 50, is_active: true, is_favorite: true },
            ],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

function wrapper(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe('ProductsPage smoke', () => {
  it('renders product rows', async () => {
    render(wrapper(<ProductsPage />));
    expect(await screen.findByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('BEV-AMER')).toBeInTheDocument();
  });
});
