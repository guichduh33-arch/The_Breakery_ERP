// apps/backoffice/src/pages/reports/__tests__/permission-changes-page.smoke.test.tsx
// S40 Wave B3 — Smoke test: PermissionChangesPage renders heading, calls RPC, shows changes + CSV.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PermissionChangesPage from '@/pages/reports/PermissionChangesPage.js';

// Mutable flag read by the rpc mock to switch between happy path and error path.
let simulateError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (simulateError) {
        return Promise.resolve({ data: null, error: { message: 'RPC permission changes error' } });
      }
      if (fn === 'get_permission_changes_v1') {
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

describe('PermissionChangesPage (smoke)', () => {
  beforeEach(() => { simulateError = false; });

  it('renders heading, change rows with action badges, and CSV export once data loads', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Permission Change Log/i, level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('SuperAdmin')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('granted')).toBeInTheDocument();
    expect(screen.getByText('revoked')).toBeInTheDocument();
    expect(screen.getByText('reports.financial.read')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    });
    // No PDF export button (CSV-only page)
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces an error message when the RPC fails', async () => {
    simulateError = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('RPC permission changes error');
  });
});
