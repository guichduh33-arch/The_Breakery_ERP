// apps/backoffice/src/pages/inventory/__tests__/SectionsPage.smoke.test.tsx
// Session 14 / Phase 4.C — smoke test for the rewritten SectionsPage.
//
// Mocks the data hook + the SectionFormModal to keep the suite focused on
// the page chrome (header, KPI tiles, DataTable rows, action gating).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SectionsPage from '@/pages/inventory/SectionsPage.js';
import type { SectionRow } from '@/features/sections/hooks/useSectionsList.js';

const MOCK_SECTIONS: SectionRow[] = [
  {
    id:            's-1',
    code:          'KIT',
    name:          'Kitchen',
    kind:          'production',
    is_active:     true,
    display_order: 1,
    created_at:    '2026-01-01T00:00:00Z',
    updated_at:    '2026-01-01T00:00:00Z',
    deleted_at:    null,
  },
  {
    id:            's-2',
    code:          'WHS',
    name:          'Main Warehouse',
    kind:          'warehouse',
    is_active:     true,
    display_order: 2,
    created_at:    '2026-01-01T00:00:00Z',
    updated_at:    '2026-01-01T00:00:00Z',
    deleted_at:    null,
  },
];

vi.mock('@/features/sections/hooks/useSectionsList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/sections/hooks/useSectionsList.js')>();
  return {
    ...actual,
    useSectionsList:      () => ({ data: MOCK_SECTIONS, isLoading: false, error: null }),
    useSoftDeleteSection: () => ({ mutate: () => {}, isPending: false }),
  };
});

let currentPerms = new Set<string>(['inventory.read', 'inventory.sections.update']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

vi.mock('@/features/sections/components/SectionFormModal.js', () => ({
  SectionFormModal: () => null,
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SectionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SectionsPage (Phase 4.C rewrite)', () => {
  it('renders the page header, KPI tiles, and the seeded rows', () => {
    currentPerms = new Set(['inventory.read', 'inventory.sections.update']);
    renderPage();
    expect(screen.getByRole('heading', { name: /^Sections$/i })).toBeInTheDocument();
    // The page contains multiple matches for "Warehouse"/"Production" (KPI
    // labels + table values) — check that at least one match exists rather
    // than asserting uniqueness.
    expect(screen.getAllByText(/Warehouse/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Production/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
  });

  it('renders the New section button when permission is granted', () => {
    currentPerms = new Set(['inventory.read', 'inventory.sections.update']);
    renderPage();
    expect(screen.getByRole('button', { name: /New section/i })).toBeInTheDocument();
  });

  it('hides write controls when the user lacks inventory.sections.update', () => {
    currentPerms = new Set(['inventory.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /New section/i })).not.toBeInTheDocument();
    // Reset for other tests in the same worker process.
    currentPerms = new Set(['inventory.read', 'inventory.sections.update']);
  });
});
