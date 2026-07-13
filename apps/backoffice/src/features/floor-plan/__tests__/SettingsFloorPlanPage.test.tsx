// apps/backoffice/src/features/floor-plan/__tests__/SettingsFloorPlanPage.test.tsx
// S75 Task 3 — smoke test (brief verbatim).
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsFloorPlanPage from '@/pages/settings/SettingsFloorPlanPage.js';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));
vi.mock('@/features/floor-plan/hooks/useFloorPlanAdmin.js', () => ({
  useFloorPlanTables: () => ({ data: [
    { id: 't1', name: 'T-01', seats: 4, sort_order: 0, is_active: true, section_id: 's1', table_sections: { name: 'Interior', sort_order: 0 } },
    { id: 't2', name: 'Patio-1', seats: 6, sort_order: 100, is_active: true, section_id: 's2', table_sections: { name: 'Terrace', sort_order: 100 } },
    { id: 't3', name: 'T-99', seats: 2, sort_order: 1, is_active: false, section_id: 's1', table_sections: { name: 'Interior', sort_order: 0 } },
  ], isLoading: false, error: null }),
  useTableSections: () => ({ data: [
    { id: 's1', name: 'Interior', sort_order: 0, is_active: true },
    { id: 's2', name: 'Terrace', sort_order: 100, is_active: true },
  ], isLoading: false, error: null }),
  useCreateTable: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTable: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTable: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSection: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSection: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSection: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('SettingsFloorPlanPage', () => {
  it('groups tables under their section and shows the add CTA', () => {
    render(<SettingsFloorPlanPage />);
    expect(screen.getByText('Interior')).toBeInTheDocument();
    expect(screen.getByText('Terrace')).toBeInTheDocument();
    expect(screen.getByText('T-01')).toBeInTheDocument();
    expect(screen.getByText('Patio-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add table/i })).toBeInTheDocument();
  });

  it('shows an inactive table with an Inactive badge and a Reactivate action', () => {
    render(<SettingsFloorPlanPage />);
    expect(screen.getByText('T-99')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reactivate table T-99/i })).toBeInTheDocument();
    // Deactivate is the reversible flip; Delete is the separate permanent action.
    expect(screen.getByRole('button', { name: /deactivate table T-01/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete table T-01/i })).toBeInTheDocument();
  });
});
