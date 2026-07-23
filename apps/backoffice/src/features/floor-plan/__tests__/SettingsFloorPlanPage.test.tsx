// apps/backoffice/src/features/floor-plan/__tests__/SettingsFloorPlanPage.test.tsx
// S75 Task 3 — smoke test (brief verbatim).
// Lot A floor plan visuel (ADR-006 déc. 9) — vue Plan : grille + drag & drop.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsFloorPlanPage from '@/pages/settings/SettingsFloorPlanPage.js';

const { moveMock } = vi.hoisted(() => ({ moveMock: vi.fn() }));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));
vi.mock('@/features/floor-plan/hooks/useFloorPlanAdmin.js', () => ({
  useFloorPlanTables: () => ({ data: [
    { id: 't1', name: 'T-01', seats: 4, sort_order: 0, is_active: true, section_id: 's1', grid_x: 2, grid_y: 1, table_sections: { name: 'Interior', sort_order: 0 } },
    { id: 't2', name: 'Patio-1', seats: 6, sort_order: 100, is_active: true, section_id: 's2', grid_x: null, grid_y: null, table_sections: { name: 'Terrace', sort_order: 100 } },
    { id: 't3', name: 'T-99', seats: 2, sort_order: 1, is_active: false, section_id: 's1', grid_x: null, grid_y: null, table_sections: { name: 'Interior', sort_order: 0 } },
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
  useSetTablePosition: () => ({ mutate: moveMock, isPending: false }),
  mapFloorPlanError: (m: string) => m,
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

  // ADR-006 déc. 9 lot A — vue Plan.
  it('plan view places positioned tables on their cell, others in the tray', () => {
    render(<SettingsFloorPlanPage />);
    fireEvent.click(screen.getByTestId('fp-view-plan'));

    // T-01 (grid 2,1) rendue DANS sa cellule ; T-99 (non placée) dans le bac Interior.
    const cell = screen.getAllByTestId('fp-cell-2-1')[0]!;
    expect(cell.textContent).toContain('T-01');
    const trays = screen.getAllByTestId('fp-tray');
    expect(trays.some((tr) => tr.textContent?.includes('T-99'))).toBe(true);
    expect(trays.some((tr) => tr.textContent?.includes('Patio-1'))).toBe(true);
  });

  it('dropping a table on an empty cell saves its position via the RPC hook', () => {
    moveMock.mockClear();
    render(<SettingsFloorPlanPage />);
    fireEvent.click(screen.getByTestId('fp-view-plan'));

    // Grille de la 2ᵉ section (Terrace) : drop de Patio-1 (t2) sur (0,0).
    const terraceCell = screen.getAllByTestId('fp-cell-0-0')[1]!;
    fireEvent.drop(terraceCell, { dataTransfer: { getData: () => 't2' } });

    expect(moveMock).toHaveBeenCalledWith(
      { id: 't2', grid_x: 0, grid_y: 0 },
      expect.anything(),
    );
  });

  it('dropping a placed table on the tray unplaces it (NULL/NULL)', () => {
    moveMock.mockClear();
    render(<SettingsFloorPlanPage />);
    fireEvent.click(screen.getByTestId('fp-view-plan'));

    const interiorTray = screen.getAllByTestId('fp-tray')[0]!;
    fireEvent.drop(interiorTray, { dataTransfer: { getData: () => 't1' } });

    expect(moveMock).toHaveBeenCalledWith(
      { id: 't1', grid_x: null, grid_y: null },
      expect.anything(),
    );
  });
});
