// apps/pos/src/features/kds/__tests__/StationFilter.smoke.test.tsx
// Session 13 / Phase 4.B — RTL smoke for the KDS station chip picker.
// Critique run 3 (distill) — the chips are DATA-DERIVED: the row only renders
// when the loaded tickets carry at least two distinct kds_station values, and
// only the present stations get a chip. A stale active filter whose chip
// vanished resets to 'all' (it would silently empty the board otherwise).

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

  it('renders nothing when the tickets carry fewer than two distinct stations', () => {
    const { rerender } = render(<StationFilter presentStations={new Set(['expo'])} />);
    expect(screen.queryByRole('group', { name: /kds station filter/i })).toBeNull();

    rerender(<StationFilter presentStations={new Set()} />);
    expect(screen.queryByRole('group', { name: /kds station filter/i })).toBeNull();
  });

  it('renders All + one chip per PRESENT station only', () => {
    render(<StationFilter presentStations={new Set(['hot', 'bar'])} />);

    expect(screen.getByRole('button', { name: /show all kds stations/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /filter to hot kitchen items/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /filter to bar items/i })).toBeInTheDocument();
    // Absent stations render no chip.
    expect(screen.queryByRole('button', { name: /filter to cold prep items/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /filter to prep\/bakery items/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /filter to expedite\/pickup items/i })).toBeNull();
  });

  it('shows the active chip as aria-pressed', () => {
    storeState.kdsStationFilter = 'hot';
    render(<StationFilter presentStations={new Set(['hot', 'cold'])} />);
    const hot = screen.getByRole('button', { name: /filter to hot kitchen items/i });
    expect(hot.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls setKdsStationFilter on click', () => {
    render(<StationFilter presentStations={new Set(['hot', 'bar'])} />);
    fireEvent.click(screen.getByRole('button', { name: /filter to bar items/i }));
    expect(storeState.setKdsStationFilter).toHaveBeenCalledWith('bar');
  });

  it('resets a stale active filter to all when its station disappears from the data', () => {
    storeState.kdsStationFilter = 'hot';
    render(<StationFilter presentStations={new Set(['bar', 'expo'])} />);
    expect(storeState.setKdsStationFilter).toHaveBeenCalledWith('all');
  });
});
