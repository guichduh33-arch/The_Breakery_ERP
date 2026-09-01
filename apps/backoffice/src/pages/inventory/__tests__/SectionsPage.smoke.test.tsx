// apps/backoffice/src/pages/inventory/__tests__/SectionsPage.smoke.test.tsx
// Session 14 / Phase 4.C — smoke test for the rewritten SectionsPage.
//
// Mocks the data hook + the SectionFormModal to keep the suite focused on
// the page chrome (header, KPI tile, DataTable rows, action gating).
//
// ADR-027 — l'écran est recentré sur les STATIONS DE PRODUCTION : la table ne
// montre que `kind === 'production'`, et une section warehouse d'époque doit
// donc en être ABSENTE. C'est le sens que fige ce fichier.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SectionsPage from '@/pages/inventory/SectionsPage.js';
import type * as SectionsListModule from '@/features/sections/hooks/useSectionsList.js';
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
    code:          'BAR',
    name:          'Bar',
    kind:          'production',
    is_active:     true,
    display_order: 2,
    created_at:    '2026-01-01T00:00:00Z',
    updated_at:    '2026-01-01T00:00:00Z',
    deleted_at:    null,
  },
];

const LEGACY_WAREHOUSE: SectionRow = {
  id:            's-9',
  code:          'WHS',
  name:          'Main Warehouse',
  kind:          'warehouse',
  is_active:     true,
  display_order: 9,
  created_at:    '2026-01-01T00:00:00Z',
  updated_at:    '2026-01-01T00:00:00Z',
  deleted_at:    null,
};

let withLegacyWarehouse = false;

vi.mock('@/features/sections/hooks/useSectionsList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SectionsListModule>();
  return {
    ...actual,
    useSectionsList: () => ({
      data: withLegacyWarehouse ? [...MOCK_SECTIONS, LEGACY_WAREHOUSE] : MOCK_SECTIONS,
      isLoading: false,
      error: null,
    }),
    useSoftDeleteSection: () => ({ mutate: () => { /* noop */ }, isPending: false }),
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

describe('SectionsPage — stations de production (ADR-027)', () => {
  it('renders the page header, the station KPI, and the seeded rows', () => {
    currentPerms = new Set(['inventory.read', 'inventory.sections.update']);
    renderPage();
    expect(screen.getByRole('heading', { name: /Production stations/i })).toBeInTheDocument();
    // « Stations » est rendu DEUX fois depuis le fil d'Ariane du 2026-09-01 :
    // le repère de navigation, et le libellé de la tuile de compteur. On vise
    // chacun par sa région plutôt que par son texte nu — un `getByText` global
    // ne dit plus lequel des deux il a trouvé.
    const crumb = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(crumb).toHaveTextContent('Stock');
    expect(crumb).toHaveTextContent('Stations');
    expect(screen.getAllByText('Stations').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('Bar')).toBeInTheDocument();
  });

  it('ne liste PAS une section warehouse d’époque', () => {
    currentPerms = new Set(['inventory.read', 'inventory.sections.update']);
    withLegacyWarehouse = true;
    renderPage();
    expect(screen.queryByText('Main Warehouse')).not.toBeInTheDocument();
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    withLegacyWarehouse = false;
  });

  it('renders the New station button when permission is granted', () => {
    currentPerms = new Set(['inventory.read', 'inventory.sections.update']);
    renderPage();
    expect(screen.getByRole('button', { name: /New station/i })).toBeInTheDocument();
  });

  it('hides write controls when the user lacks inventory.sections.update', () => {
    currentPerms = new Set(['inventory.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /New station/i })).not.toBeInTheDocument();
    // Reset for other tests in the same worker process.
    currentPerms = new Set(['inventory.read', 'inventory.sections.update']);
  });
});
