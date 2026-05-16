// apps/backoffice/src/features/inventory-production/__tests__/ScheduleSlotCell.smoke.test.tsx
// Session 15 / Phase 4.B — ScheduleSlotCell smoke tests.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/supabase.js', () => ({ supabase: {} }));

import { ScheduleSlotCell } from '../components/ScheduleSlotCell.js';
import type { ScheduleRow } from '../hooks/useProductionSchedule.js';

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

describe('ScheduleSlotCell smoke', () => {
  it('renders empty cell with slot label + Add button', () => {
    const onAdd = vi.fn();
    const onClick = vi.fn();
    render(
      <ScheduleSlotCell
        date="2026-05-18"
        slot="7am"
        schedules={[]}
        onAddClick={onAdd}
        onScheduleClick={onClick}
      />,
    );
    expect(screen.getByText('7am')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Add schedule on 2026-05-18 7am/i));
    expect(onAdd).toHaveBeenCalledWith('2026-05-18', '7am');
  });

  it('renders N schedules + correct count + status dots', () => {
    const schedules: ScheduleRow[] = [
      row({ id: 'r-1', status: 'scheduled', recipeName: 'Croissant', plannedQty: 24 }),
      row({ id: 'r-2', status: 'started',   recipeName: 'Baguette',  plannedQty: 12 }),
      row({ id: 'r-3', status: 'completed', recipeName: 'Pain choco', plannedQty: 18 }),
    ];
    render(
      <ScheduleSlotCell
        date="2026-05-18"
        slot="5am"
        schedules={schedules}
        onAddClick={() => {}}
        onScheduleClick={() => {}}
      />,
    );

    expect(screen.getByLabelText('count').textContent).toBe('3');
    // Status dots — one per schedule, with status aria-label.
    expect(screen.getByLabelText('status scheduled')).toBeInTheDocument();
    expect(screen.getByLabelText('status started')).toBeInTheDocument();
    expect(screen.getByLabelText('status completed')).toBeInTheDocument();
    // Schedule names rendered.
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Baguette')).toBeInTheDocument();
    expect(screen.getByText('Pain choco')).toBeInTheDocument();
  });

  it('clicking a schedule pill triggers onScheduleClick with the row', () => {
    const handler = vi.fn();
    const r = row({ id: 'r-9', recipeName: 'Tartelette' });
    render(
      <ScheduleSlotCell
        date="2026-05-18"
        slot="11am"
        schedules={[r]}
        onAddClick={() => {}}
        onScheduleClick={handler}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Schedule Tartelette 24/i));
    expect(handler).toHaveBeenCalledWith(r);
  });
});
