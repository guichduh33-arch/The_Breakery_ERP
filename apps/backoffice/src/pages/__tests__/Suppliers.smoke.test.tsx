// apps/backoffice/src/pages/__tests__/Suppliers.smoke.test.tsx
//
// Session 14 / Phase 5.A — smoke for the rewritten Suppliers grid page.
// Mocks the data hooks + the modal components to keep the test focused on the
// page chrome (header, KPI tiles, search, supplier cards, permission gating).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SuppliersPage from '@/pages/Suppliers.js';
import type { SupplierRow } from '@/features/suppliers/hooks/useSuppliersList.js';

const MOCK_SUPPLIERS: SupplierRow[] = [
  {
    id:                 'sup-1',
    code:               'CGS',
    name:               'CAKRA GEMILANG SEJAHTERA',
    contact_phone:      '81934342324',
    contact_email:      null,
    address:            null,
    payment_terms_days: 30,
    notes:              null,
    is_active:          true,
    deleted_at:         null,
    created_at:         '2026-04-01T00:00:00Z',
    updated_at:         '2026-04-01T00:00:00Z',
  },
  {
    id:                 'sup-2',
    code:               'BBI',
    name:               'bali bless indo',
    contact_phone:      null,
    contact_email:      null,
    address:            null,
    payment_terms_days: 30,
    notes:              null,
    is_active:          false,
    deleted_at:         null,
    created_at:         '2026-04-01T00:00:00Z',
    updated_at:         '2026-04-01T00:00:00Z',
  },
];

vi.mock('@/features/suppliers/hooks/useSuppliersList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/suppliers/hooks/useSuppliersList.js')>();
  return {
    ...actual,
    useSuppliersList: () => ({ data: MOCK_SUPPLIERS, isLoading: false, error: null }),
  };
});

vi.mock('@/features/suppliers/hooks/useUpdateSupplier.js', () => ({
  useUpdateSupplier: () => ({ mutate: () => {}, isPending: false }),
}));

vi.mock('@/features/suppliers/components/SupplierFormModal.js', () => ({
  SupplierFormModal: () => null,
}));

vi.mock('@/features/suppliers/components/SupplierDeleteConfirm.js', () => ({
  SupplierDeleteConfirm: () => null,
}));

let currentPerms = new Set<string>(['suppliers.read', 'suppliers.create', 'suppliers.update']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SuppliersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SuppliersPage (Phase 5.A rewrite)', () => {
  it('renders the supplier management heading + KPI tiles + supplier cards', () => {
    currentPerms = new Set(['suppliers.read', 'suppliers.create', 'suppliers.update']);
    renderPage();
    expect(screen.getByRole('heading', { name: /Supplier Management/i })).toBeInTheDocument();
    // Both KPI tile values + the contact phone render in the same DOM, so we
    // assert on at least one match for the tile labels.
    expect(screen.getAllByText(/Total Suppliers/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Active/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/CAKRA GEMILANG SEJAHTERA/i)).toBeInTheDocument();
    expect(screen.getByText(/bali bless indo/i)).toBeInTheDocument();
  });

  it('shows the Add new supplier CTA when create permission is granted', () => {
    currentPerms = new Set(['suppliers.read', 'suppliers.create']);
    renderPage();
    expect(screen.getByRole('button', { name: /Add new supplier/i })).toBeInTheDocument();
  });

  it('hides write controls when only read permission is granted', () => {
    currentPerms = new Set(['suppliers.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /Add new supplier/i })).not.toBeInTheDocument();
    // Reset for any other tests sharing this worker.
    currentPerms = new Set(['suppliers.read', 'suppliers.create', 'suppliers.update']);
  });

  it('blocks rendering when the user lacks suppliers.read', () => {
    currentPerms = new Set();
    renderPage();
    expect(screen.queryByRole('heading', { name: /Supplier Management/i })).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission to view suppliers/i)).toBeInTheDocument();
    currentPerms = new Set(['suppliers.read', 'suppliers.create', 'suppliers.update']);
  });
});
