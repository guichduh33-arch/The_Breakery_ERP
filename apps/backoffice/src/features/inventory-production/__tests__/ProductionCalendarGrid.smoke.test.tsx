// apps/backoffice/src/features/inventory-production/__tests__/ProductionCalendarGrid.smoke.test.tsx
// Session 15 / Phase 4.B — ProductionCalendarGrid smoke tests.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The hooks module imports @/lib/supabase which validates env at module-load
// time. Stub it before importing anything that pulls it in transitively.
vi.mock('@/lib/supabase.js', () => ({ supabase: {} }));

import { ProductionCalendarGrid } from '../components/ProductionCalendarGrid.js';
import type { ScheduleRow } from '../hooks/useProductionSchedule.js';

function mondayUtc(): Date {
  // 2026-05-18 is a Monday.
  return new Date(Date.UTC(2026, 4, 18));
}

function row(over: Partial<ScheduleRow>): ScheduleRow {
  return {
    id:                'r-1',
    scheduledDate:     '2026-05-18',
    slot:              '5am',
    recipeId:          'p-1',
    recipeName:        'Croissant',
    plannedQty:        24,
    status:            'scheduled',
    notes:             null,
    completedRecordId: null,
    createdBy:         null,
    createdAt:         '2026-05-16T00:00:00Z',
    updatedAt:         '2026-05-16T00:00:00Z',
    ...over,
  };
}

describe('ProductionCalendarGrid smoke', () => {
  it('renders 7 day headers + 28 slot cells (4 slots * 7 days)', () => {
    render(
      <ProductionCalendarGrid
        weekStart={mondayUtc()}
        schedules={[]}
        onCellClick={() => {}}
        onScheduleClick={() => {}}
      />,
    );
    const headers = screen.getAllByTestId('grid-header');
    expect(headers).toHaveLength(7);
    const cells = screen.getAllByTestId('schedule-slot-cell');
    expect(cells).toHaveLength(28);
    // Day labels are present.
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
  });

  it('clicking an empty cell calls onCellClick with (date, slot)', () => {
    const onCellClick = vi.fn();
    render(
      <ProductionCalendarGrid
        weekStart={mondayUtc()}
        schedules={[]}
        onCellClick={onCellClick}
        onScheduleClick={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Add schedule on 2026-05-18 5am/i));
    expect(onCellClick).toHaveBeenCalledWith('2026-05-18', '5am');
  });

  it('clicking a schedule pill calls onScheduleClick with the row', () => {
    const onScheduleClick = vi.fn();
    const r = row({ id: 'r-x', recipeName: 'Brioche', plannedQty: 6 });
    render(
      <ProductionCalendarGrid
        weekStart={mondayUtc()}
        schedules={[r]}
        onCellClick={() => {}}
        onScheduleClick={onScheduleClick}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Schedule Brioche 6/i));
    expect(onScheduleClick).toHaveBeenCalledWith(r);
  });
});
