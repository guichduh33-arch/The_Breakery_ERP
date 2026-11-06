import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CreateManualJEModal } from '../components/CreateManualJEModal.js';
import { HolidayFormModal } from '@/features/settings/components/HolidayFormModal.js';

vi.mock('../hooks/usePostableAccounts.js', () => ({ usePostableAccounts: () => ({ data: [] }) }));
vi.mock('../hooks/useCreateManualJournalEntry.js', () => ({ useCreateManualJournalEntry: () => ({ isPending: false }) }));
vi.mock('@/features/settings/hooks/useHolidays.js', () => ({
  useCreateHoliday: () => ({ isPending: false }), useUpdateHoliday: () => ({ isPending: false }),
}));

afterEach(() => vi.useRealTimers());

describe('date métier des formulaires', () => {
  it('initialise une écriture au jour WITA avant 08 h', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T17:00:00Z'));
    render(<CreateManualJEModal onClose={vi.fn()} />);
    expect(screen.getByTestId('je-modal-entry-date')).toHaveValue('2026-11-07');
  });

  it('recalcule la date du jour à chaque ouverture de création de jour férié', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T17:00:00Z'));
    const close = vi.fn();
    const view = render(<HolidayFormModal open mode="create" onClose={close} />);
    expect(document.querySelector('input[type="date"]')).toHaveValue('2026-11-07');
    view.rerender(<HolidayFormModal open={false} mode="create" onClose={close} />);
    vi.setSystemTime(new Date('2026-11-07T17:00:00Z'));
    view.rerender(<HolidayFormModal open mode="create" onClose={close} />);
    expect(document.querySelector('input[type="date"]')).toHaveValue('2026-11-08');
  });
});
