// apps/backoffice/src/pages/reports/__tests__/price-changes-page.smoke.test.tsx
// Journal des prix de vente : titre, appel RPC, lignes, « first recorded », CSV.
//
// Lot G (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : l'export passe par le menu unique du bandeau, l'erreur par la bannière
// unifiée, et les colonnes se trient. Le tri verrouille ici la règle qui a le
// plus de chances de se perdre : un `old_price` ABSENT (« first recorded »)
// reste en bas du classement dans les DEUX sens — ce n'est pas un prix de zéro.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PriceChangesPage from '@/pages/reports/PriceChangesPage.js';
import { useAuthStore } from '@/stores/authStore.js';

// Drapeau mutable lu par le mock rpc pour basculer sur le chemin d'erreur.
let simulateError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (simulateError) {
        return Promise.resolve({ data: null, error: { message: 'RPC price changes error' } });
      }
      if (fn === 'get_price_changes_v1') {
        return Promise.resolve({
          data: {
            period:  { start: '2026-05-13', end: '2026-06-12' },
            changes: [
              {
                changed_at:   '2026-06-01T10:00:00Z',
                actor_name:   'Admin',
                product_id:   'p-1',
                product_name: 'Croissant',
                new_price:    25_000,
                old_price:    22_000,
                delta_pct:    13.6,
              },
              {
                changed_at:   '2026-06-02T11:00:00Z',
                actor_name:   'Manager',
                product_id:   'p-2',
                product_name: 'Baguette',
                new_price:    18_000,
                old_price:    null,
                delta_pct:    null,
              },
            ],
            truncated: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // Le sélecteur produit interroge .from('products')
    from: () => ({
      select: () => ({
        is: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PriceChangesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Le tableau une fois la donnée arrivée (la carte rend un squelette avant). */
async function loadedTable(): Promise<HTMLElement> {
  const table = await screen.findByTestId('price-changes-table');
  await within(table).findByText('Croissant');
  return table;
}

// L'export est gouverné par `reports.export`. Ce test vérifie le CÂBLAGE, pas
// le RBAC : on seede la permission.
beforeEach(() => {
  sessionStorage.clear();
  useAuthStore.setState({ permissions: ['reports.export'] });
  simulateError = false;
});

describe('PriceChangesPage (smoke)', () => {
  it('renders heading, change rows, first-recorded label, and CSV export once data loads', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Price Changes/i, level: 1 })).toBeInTheDocument();
    const table = await loadedTable();
    expect(within(table).getByText('Baguette')).toBeInTheDocument();
    // « first recorded » pour un old_price nul.
    expect(within(table).getByText(/first recorded/i)).toBeInTheDocument();

    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    // Aucun PDF (page CSV seule).
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('conserve le filtre produit dans le bandeau', async () => {
    renderPage();
    await loadedTable();
    expect(screen.getByLabelText('Filter by product')).toBeInTheDocument();
  });

  it('surfaces the unified error banner when the RPC fails', async () => {
    simulateError = true;
    renderPage();
    expect(await screen.findByTestId('report-error')).toHaveTextContent('RPC price changes error');
  });

  describe('tri de colonne (lot G)', () => {
    const products = (table: HTMLElement): string[] =>
      within(table).getAllByRole('row').slice(1)
        .map((r) => r.querySelectorAll('td')[1]?.textContent ?? '')
        .filter((t) => t !== '');

    it('en-tête = bouton focusable + aria-sort, cycle asc → desc → ordre serveur', async () => {
      const table = await (renderPage(), loadedTable());
      expect(products(table)).toEqual(['Croissant', 'Baguette']);

      const header = screen.getByRole('columnheader', { name: 'Product' });
      const button = within(header).getByRole('button', { name: 'Product' });
      expect(header).toHaveAttribute('aria-sort', 'none');

      fireEvent.click(button);
      expect(header).toHaveAttribute('aria-sort', 'ascending');
      expect(products(table)).toEqual(['Baguette', 'Croissant']);

      fireEvent.click(button);
      expect(header).toHaveAttribute('aria-sort', 'descending');
      expect(products(table)).toEqual(['Croissant', 'Baguette']);

      fireEvent.click(button);
      expect(header).toHaveAttribute('aria-sort', 'none');
      expect(products(table)).toEqual(['Croissant', 'Baguette']);
    });

    it('« first recorded » (old_price nul) reste EN BAS dans les deux sens', async () => {
      const table = await (renderPage(), loadedTable());
      const header = screen.getByRole('columnheader', { name: 'Old Price' });
      const button = within(header).getByRole('button', { name: 'Old Price' });

      fireEvent.click(button);                       // ascendant
      expect(products(table)).toEqual(['Croissant', 'Baguette']);
      fireEvent.click(button);                       // descendant
      expect(products(table)).toEqual(['Croissant', 'Baguette']);
    });
  });
});
