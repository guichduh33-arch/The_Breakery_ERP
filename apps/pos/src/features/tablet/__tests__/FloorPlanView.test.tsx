// apps/pos/src/features/tablet/__tests__/FloorPlanView.test.tsx
//
// Session 14 / Phase 3.C — Tablet floor plan view smoke.
//
// Pure presentational component (no data hooks, no Supabase). We verify:
//   - Header + section tabs render with the right counts.
//   - Tapping an available table fires onTableSelect with the table name.
//   - Tapping an occupied table does NOT fire onTableSelect.
//   - Section tabs swap which tables are visible.
//   - Touch targets meet the 44px minimum (min-h-11 utility on tabs;
//     table cells are h-28 / h-24 = ≥96px so always pass).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { RestaurantTable } from '@breakery/domain';
import { FloorPlanView } from '../FloorPlanView';

const TABLES: RestaurantTable[] = [
  { id: 't1', name: 'T1', seats: 2, sort_order: 1, is_active: true, grid_x: null, grid_y: null, section_id: null },
  { id: 't2', name: 'T2', seats: 4, sort_order: 2, is_active: true, grid_x: null, grid_y: null, section_id: null },
  {
    id: 't10',
    name: 'T10',
    seats: 4,
    sort_order: 110,
    is_active: true, grid_x: null, grid_y: null,
    section_id: 'sec-terrace',
    table_sections: { name: 'Terrace', sort_order: 100 },
  },
  {
    id: 't12',
    name: 'T12',
    seats: 4,
    sort_order: 112,
    is_active: true, grid_x: null, grid_y: null,
    section_id: 'sec-terrace',
    table_sections: { name: 'Terrace', sort_order: 100 },
  },
];

describe('FloorPlanView', () => {
  it('renders the header, both section tabs, and the floor canvas', () => {
    render(
      <FloorPlanView
        tables={TABLES}
        occupancy={{}}
        onTableSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('FLOOR PLAN')).toBeInTheDocument();
    expect(screen.getByTestId('tablet-floor-plan')).toBeInTheDocument();
    expect(screen.getByTestId('tablet-floor-plan-canvas')).toBeInTheDocument();
    const interiorTab = screen.getByTestId('tablet-floor-plan-section-interior');
    const terraceTab = screen.getByTestId('tablet-floor-plan-section-terrace');
    expect(interiorTab).toHaveTextContent('Interior');
    expect(interiorTab).toHaveTextContent('(2)');
    expect(terraceTab).toHaveTextContent('Terrace');
    expect(terraceTab).toHaveTextContent('(2)');
    // Tactile sizing: section tabs must be ≥44px tall.
    expect(interiorTab).toHaveClass('min-h-11');
    expect(terraceTab).toHaveClass('min-h-11');
  });

  it('fires onTableSelect with the table name when an available table is tapped', () => {
    const onTableSelect = vi.fn();
    render(
      <FloorPlanView
        tables={TABLES}
        occupancy={{ T2: true }} // T2 is occupied — T1 still free
        onTableSelect={onTableSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('floor-plan-cell-T1'));
    expect(onTableSelect).toHaveBeenCalledTimes(1);
    expect(onTableSelect).toHaveBeenCalledWith('T1');
  });

  it('does NOT fire onTableSelect when an occupied table is tapped', () => {
    const onTableSelect = vi.fn();
    render(
      <FloorPlanView
        tables={TABLES}
        occupancy={{ T2: true }}
        onTableSelect={onTableSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('floor-plan-cell-T2'));
    expect(onTableSelect).not.toHaveBeenCalled();
  });

  it('swaps visible tables when the Terrace section tab is selected', () => {
    render(
      <FloorPlanView
        tables={TABLES}
        occupancy={{}}
        onTableSelect={vi.fn()}
      />,
    );
    // Default = interior (T1, T2 visible; T10, T12 hidden).
    expect(screen.getByTestId('floor-plan-cell-T1')).toBeInTheDocument();
    expect(screen.queryByTestId('floor-plan-cell-T10')).toBeNull();

    fireEvent.click(screen.getByTestId('tablet-floor-plan-section-terrace'));
    expect(screen.queryByTestId('floor-plan-cell-T1')).toBeNull();
    expect(screen.getByTestId('floor-plan-cell-T10')).toBeInTheDocument();
    expect(screen.getByTestId('floor-plan-cell-T12')).toBeInTheDocument();
  });

  it('renders an empty-section message when there are no tables at all', () => {
    render(
      <FloorPlanView
        tables={[]}
        occupancy={{}}
        onTableSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/no tables configured/i)).toBeInTheDocument();
  });
});
