// apps/pos/src/features/kds/__tests__/StationFilter.smoke.test.tsx
// Session 13 / Phase 4.B — RTL smoke for the KDS station chip picker.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { StationFilter } from '../components/StationFilter';

const storeState = { kdsStationFilter: 'all' as string, setKdsStationFilter: vi.fn() };

vi.mock('@/stores/kdsStore', () => ({
  useKdsStore: <T,>(selector: (s: typeof storeState) => T) => selector(storeState),
}));

describe('StationFilter', () => {
  beforeEach(() => {
    storeState.kdsStationFilter = 'all';
    storeState.setKdsStationFilter.mockReset();
  });

  it('renders all 6 chips', () => {
    render(<StationFilter />);
    // Each chip carries a unique aria-label distinct from the substring.
    [
      /Show all KDS stations/i,
      /Filter to hot kitchen items/i,
      /Filter to cold prep items/i,
      /Filter to bar items/i,
      /Filter to prep\/bakery items/i,
      /Filter to expedite\/pickup items/i,
    ].forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
  });

  it('shows the active chip as aria-pressed', () => {
    storeState.kdsStationFilter = 'hot';
    render(<StationFilter />);
    const hot = screen.getByRole('button', { name: /Filter to hot kitchen items/i });
    expect(hot.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls setKdsStationFilter on click', () => {
    render(<StationFilter />);
    fireEvent.click(screen.getByRole('button', { name: /Filter to bar items/i }));
    expect(storeState.setKdsStationFilter).toHaveBeenCalledWith('bar');
  });
});
