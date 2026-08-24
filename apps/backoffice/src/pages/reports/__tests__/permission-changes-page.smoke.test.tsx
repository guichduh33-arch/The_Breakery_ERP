// apps/backoffice/src/pages/reports/__tests__/permission-changes-page.smoke.test.tsx
// Trace des droits : titre, appel RPC, pastilles d'action, CSV.
//
// Lot G (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : l'export passe par le menu unique du bandeau, l'erreur par la bannière
// unifiée, et les colonnes se trient. `detail` reste NON triable — un contexte
// libre n'a pas d'ordre.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PermissionChangesPage from '@/pages/reports/PermissionChangesPage.js';
import { useAuthStore } from '@/stores/authStore.js';

// Drapeau mutable lu par le mock rpc pour basculer sur le chemin d'erreur.
let simulateError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (simulateError) {
        return Promise.resolve({ data: null, error: { message: 'RPC permission changes error' } });
      }
      if (fn === 'get_permission_changes_v2') {
        return Promise.resolve({
          data: {
            period:  { start: '2026-05-13', end: '2026-06-12' },
            changes: [
              {
                changed_at:      '2026-06-01T10:00:00Z',
                actor_name:      'SuperAdmin',
                action:          'granted',
                role_code:       'MANAGER',
                permission_code: 'reports.financial.read',
                detail:          { reason: 'role expansion' },
              },
              {
                changed_at:      '2026-06-02T14:30:00Z',
                actor_name:      'Admin',
                action:          'revoked',
                role_code:       'CASHIER',
                permission_code: 'orders.void',
                detail:          null,
              },
            ],
            truncated: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PermissionChangesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function loadedTable(): Promise<HTMLElement> {
  const table = await screen.findByTestId('permission-changes-table');
  await within(table).findByText('SuperAdmin');
  return table;
}

// L'export est gouverné par `reports.export`. Ce test vérifie le CÂBLAGE, pas
// le RBAC : on seede la permission.
beforeEach(() => {
  sessionStorage.clear();
  useAuthStore.setState({ permissions: ['reports.export'] });
  simulateError = false;
});

describe('PermissionChangesPage (smoke)', () => {
  it('renders heading, change rows with action badges, and CSV export once data loads', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Permission Change Log/i, level: 1 })).toBeInTheDocument();
    const table = await loadedTable();
    expect(within(table).getByText('Admin')).toBeInTheDocument();
    expect(within(table).getByText('granted')).toBeInTheDocument();
    expect(within(table).getByText('revoked')).toBeInTheDocument();
    expect(within(table).getByText('reports.financial.read')).toBeInTheDocument();

    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    // Aucun PDF (page CSV seule).
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces the unified error banner when the RPC fails', async () => {
    simulateError = true;
    renderPage();
    expect(await screen.findByTestId('report-error')).toHaveTextContent('RPC permission changes error');
  });

  describe('tri de colonne (lot G)', () => {
    const actors = (table: HTMLElement): string[] =>
      within(table).getAllByRole('row').slice(1)
        .map((r) => r.querySelectorAll('td')[1]?.textContent ?? '')
        .filter((t) => t !== '');

    it('cycle asc → desc → retour à l\'ordre serveur, avec aria-sort', async () => {
      const table = await (renderPage(), loadedTable());
      expect(actors(table)).toEqual(['SuperAdmin', 'Admin']);

      const header = screen.getByRole('columnheader', { name: 'Actor' });
      const button = within(header).getByRole('button', { name: 'Actor' });

      fireEvent.click(button);
      expect(header).toHaveAttribute('aria-sort', 'ascending');
      expect(actors(table)).toEqual(['Admin', 'SuperAdmin']);

      fireEvent.click(button);
      expect(header).toHaveAttribute('aria-sort', 'descending');
      expect(actors(table)).toEqual(['SuperAdmin', 'Admin']);

      fireEvent.click(button);
      expect(header).toHaveAttribute('aria-sort', 'none');
      expect(actors(table)).toEqual(['SuperAdmin', 'Admin']);
    });

    it('« Detail » n\'est pas triable — un contexte libre n\'a pas d\'ordre', async () => {
      await (renderPage(), loadedTable());
      const header = screen.getByRole('columnheader', { name: 'Detail' });
      expect(header).not.toHaveAttribute('aria-sort');
      expect(within(header).queryByRole('button')).toBeNull();
    });
  });
});
