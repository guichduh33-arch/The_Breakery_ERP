// apps/backoffice/src/features/settings/__tests__/SettingsHolidaysPage.smoke.test.tsx
// Session 13 / Phase 5.C — Smoke test for the holiday calendar list page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SettingsHolidaysPage from '@/pages/settings/SettingsHolidaysPage.js';

const currentPerms = new Set<string>(['settings.read', 'settings.holidays.manage']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const MOCK_HOLIDAYS = [
  { id: 'h-1', name: 'Eid al-Fitr',         date: '2026-03-20', type: 'religious', is_recurring: true,  notes: null, deleted_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'h-2', name: 'Independence Day',    date: '2026-08-17', type: 'national',  is_recurring: false, notes: null, deleted_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'h-3', name: 'Annual Cleaning Week', date: '2026-07-01', type: 'company',  is_recurring: false, notes: 'shop closed', deleted_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

interface RpcResult { data: unknown; error: { message: string } | null }

interface MockChain {
  select: () => MockChain;
  is:     () => MockChain;
  order:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(): MockChain {
    const chain: MockChain = {
      select: () => chain,
      is:     () => chain,
      order:  () => Promise.resolve({ data: MOCK_HOLIDAYS, error: null }),
    };
    return chain;
  }
  return {
    supabase: { from: () => buildChain() },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsHolidaysPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsHolidaysPage', () => {
  beforeEach(() => {
    currentPerms.clear();
    currentPerms.add('settings.read');
    currentPerms.add('settings.holidays.manage');
  });

  it('renders the page heading and seeded rows', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /^Holidays$/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Eid al-Fitr')).toBeInTheDocument();
      expect(screen.getByText('Independence Day')).toBeInTheDocument();
      expect(screen.getByText('Annual Cleaning Week')).toBeInTheDocument();
    });
  });

  it('separates recurring from fixed-date in their own sections', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Recurring \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Fixed-date \(2\)/i)).toBeInTheDocument();
    });
  });

  it('shows the New holiday button when settings.holidays.manage is granted', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New holiday/i })).toBeInTheDocument();
    });
  });

  it('hides the New holiday button when manage perm is missing', async () => {
    currentPerms.delete('settings.holidays.manage');
    renderPage();
    await waitFor(() => screen.getByText('Eid al-Fitr'));
    expect(screen.queryByRole('button', { name: /New holiday/i })).not.toBeInTheDocument();
  });

  it('shows a permission-denied message when settings.read is missing', () => {
    currentPerms.delete('settings.read');
    renderPage();
    expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument();
  });
});
