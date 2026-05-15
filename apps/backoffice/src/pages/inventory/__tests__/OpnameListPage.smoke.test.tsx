// apps/backoffice/src/pages/inventory/__tests__/OpnameListPage.smoke.test.tsx
// Session 14 / Phase 4.C — smoke tests for the rewritten OpnameListPage.
//
// Mocks the data hooks (useOpnameList) and permission store ; verifies the
// header, the KPI tiles, the DataTable rows, and the New count button.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OpnameListPage from '@/pages/inventory/OpnameListPage.js';
import type { OpnameListRow } from '@/features/inventory-opname/hooks/useOpnameList.js';

const MOCK_ROWS: OpnameListRow[] = [
  {
    id:             'op-1',
    count_number:   'OPN-2026-0001',
    section_id:     's-1',
    status:         'counting',
    started_at:     '2026-05-10T10:00:00Z',
    finalized_at:   null,
    cancelled_at:   null,
    notes:          'Weekly count — kitchen',
    created_at:     '2026-05-10T10:00:00Z',
    section:        { code: 'KIT', name: 'Kitchen' },
  },
  {
    id:             'op-2',
    count_number:   'OPN-2026-0002',
    section_id:     's-2',
    status:         'review',
    started_at:     '2026-05-11T10:00:00Z',
    finalized_at:   null,
    cancelled_at:   null,
    notes:          null,
    created_at:     '2026-05-11T10:00:00Z',
    section:        { code: 'BAR', name: 'Bar' },
  },
];

let opnameRows: OpnameListRow[] = MOCK_ROWS;
let opnameLoading = false;

vi.mock('@/features/inventory-opname/hooks/useOpnameList.js', () => ({
  useOpnameList: () => ({
    data:      opnameRows,
    isLoading: opnameLoading,
    error:     null,
  }),
}));

let currentPerms = new Set<string>(['inventory.read', 'inventory.opname.create']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

// CreateOpnameModal pulls in supabase via useSections — stub it so we don't
// need to mock the wire.
vi.mock('@/features/inventory-opname/components/CreateOpnameModal.js', () => ({
  CreateOpnameModal: () => null,
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OpnameListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpnameListPage (Phase 4.C rewrite)', () => {
  it('renders the page header and KPI tiles', () => {
    opnameRows = MOCK_ROWS;
    opnameLoading = false;
    renderPage();
    expect(screen.getByRole('heading', { name: /Stock counts/i })).toBeInTheDocument();
    // KPI tile labels
    expect(screen.getByText(/In progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Awaiting review/i)).toBeInTheDocument();
    expect(screen.getByText(/Finalized this month/i)).toBeInTheDocument();
  });

  it('renders rows from the mocked list query', () => {
    opnameRows = MOCK_ROWS;
    opnameLoading = false;
    renderPage();
    expect(screen.getByText('OPN-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('OPN-2026-0002')).toBeInTheDocument();
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('Bar')).toBeInTheDocument();
  });

  it('hides the "New count" button when the user lacks the create permission', () => {
    opnameRows = MOCK_ROWS;
    opnameLoading = false;
    currentPerms = new Set(['inventory.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /New count/i })).not.toBeInTheDocument();
    // Reset for other tests
    currentPerms = new Set(['inventory.read', 'inventory.opname.create']);
  });
});
