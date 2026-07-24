// apps/pos/src/features/floor-plan/__tests__/FloorPlanModal.test.tsx
//
// Session 14 — Phase 2.D smoke for the floor-plan modal. Pure presentational
// component (no data hooks) — we only need to verify open/closed semantics,
// section bucketing, table tap → confirm CTA, and onClose wiring.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloorPlanModal } from '../FloorPlanModal';
import type { RestaurantTable } from '@breakery/domain';

const TABLES: RestaurantTable[] = [
  { id: 't1', name: 'T1', seats: 2, sort_order: 1, is_active: true, grid_x: null, grid_y: null, section_id: null },
  { id: 't2', name: 'T2', seats: 4, sort_order: 2, is_active: true, grid_x: null, grid_y: null, section_id: null },
  {
    id: 't100',
    name: 'T100',
    seats: 4,
    sort_order: 100,
    is_active: true, grid_x: null, grid_y: null,
    section_id: 'sec-terrace',
    table_sections: { name: 'Terrace', sort_order: 100 },
  },
];

describe('FloorPlanModal', () => {
  it('renders the floor plan header and section tabs when open', () => {
    render(
      <FloorPlanModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        tables={TABLES}
        occupancy={{}}
      />,
    );
    expect(screen.getByText('FLOOR PLAN')).toBeInTheDocument();
    expect(screen.getByTestId('floor-plan-section-interior')).toBeInTheDocument();
    expect(screen.getByTestId('floor-plan-section-terrace')).toBeInTheDocument();
    expect(screen.getByTestId('floor-plan-canvas')).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    render(
      <FloorPlanModal
        open={false}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        tables={TABLES}
        occupancy={{}}
      />,
    );
    expect(screen.queryByRole('heading', { name: /floor plan/i })).toBeNull();
  });

  it('shows empty section copy when there are no tables at all', () => {
    render(
      <FloorPlanModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        tables={[]}
        occupancy={{}}
      />,
    );
    expect(screen.getByText(/no tables configured/i)).toBeInTheDocument();
  });

  it('disables the confirm CTA until a table is tapped, then fires onSelect + onClose', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <FloorPlanModal
        open
        onClose={onClose}
        onSelect={onSelect}
        tables={TABLES}
        occupancy={{ T2: true }}
      />,
    );
    const cta = screen.getByTestId<HTMLButtonElement>('floor-plan-confirm');
    expect(cta.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /table t1/i }));
    expect(cta.disabled).toBe(false);
    fireEvent.click(cta);
    expect(onSelect).toHaveBeenCalledWith('T1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ADR-006 déc. 9 lot B — rendu positionné.
  it('renders positioned tables on the 12×8 grid and the rest under Unplaced', () => {
    const positioned: RestaurantTable[] = [
      { ...TABLES[0]!, grid_x: 2, grid_y: 1 },
      TABLES[1]!, // T2 reste non placée
    ];
    const onSelect = vi.fn();
    render(
      <FloorPlanModal
        open
        onClose={vi.fn()}
        onSelect={onSelect}
        tables={positioned}
        occupancy={{}}
      />,
    );
    expect(screen.getByTestId('floor-grid')).toBeInTheDocument();
    expect(screen.getByTestId('floor-pos-2-1').textContent).toContain('T1');
    expect(screen.getByTestId('floor-unplaced').textContent).toContain('T2');

    // Une table positionnée reste sélectionnable comme avant.
    fireEvent.click(screen.getByTestId('floor-plan-cell-T1'));
    fireEvent.click(screen.getByTestId('floor-plan-confirm'));
    expect(onSelect).toHaveBeenCalledWith('T1');
  });

  it('keeps the historical flow layout when no table of the section is placed', () => {
    render(
      <FloorPlanModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        tables={TABLES}
        occupancy={{}}
      />,
    );
    expect(screen.queryByTestId('floor-grid')).toBeNull();
    expect(screen.queryByTestId('floor-unplaced')).toBeNull();
    expect(screen.getByTestId('floor-plan-cell-T1')).toBeInTheDocument();
  });

  it('honours initialSelection by pre-selecting the matching table name', () => {
    render(
      <FloorPlanModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        tables={TABLES}
        occupancy={{}}
        initialSelection="T2"
      />,
    );
    expect(screen.getByTestId('floor-plan-confirm').textContent).toMatch(/open table t2/i);
  });
});
