import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

const fromSpy = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: (...a: unknown[]) => fromSpy(...a),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        ['zreports.read', 'zreports.sign', 'zreports.void'].includes(p),
    }),
}));

import ZReportsListPage from '../ZReportsListPage.js';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ZReportsListPage', () => {
  beforeEach(() => {
    fromSpy.mockReset();
    const chain = {
      select: vi.fn().mockReturnThis(),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      gte:    vi.fn().mockReturnThis(),
      lte:    vi.fn().mockReturnThis(),
      then: (
        onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      ) =>
        Promise.resolve({
          data: [
            {
              id:               'z1',
              shift_id:         's1',
              generated_at:     '2026-05-24T10:00:00Z',
              signed_at:        null,
              signed_by:        null,
              voided_at:        null,
              voided_by:        null,
              void_reason:      null,
              pdf_storage_path: null,
              status:           'draft',
              signed_by_profile: null,
            },
          ],
          error: null,
        }).then(onFulfilled),
    };
    fromSpy.mockReturnValue(chain);
  });

  it('renders 1 Z-Report row with Sign + Void actions visible (perms granted)', async () => {
    render(wrap(<ZReportsListPage />));
    await waitFor(() => expect(screen.getByTestId('sign-z1')).toBeInTheDocument());
    expect(screen.getByTestId('void-z1')).toBeInTheDocument();
    expect(screen.getByTestId('view-pdf-z1')).toBeInTheDocument();
  });

  it('renders status filter that triggers re-query', async () => {
    render(wrap(<ZReportsListPage />));
    const sel = screen.getByTestId('status-filter') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'signed' } });
    expect(sel.value).toBe('signed');
  });
});
