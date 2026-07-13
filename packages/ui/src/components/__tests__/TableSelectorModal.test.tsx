import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TableSelectorModal, type RestaurantTable } from '../TableSelectorModal.js';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { toast } from 'sonner';

const tables: RestaurantTable[] = [
  { id: 't1', name: 'T-01', seats: 2, sort_order: 1, is_active: true, section_id: null },
  { id: 't2', name: 'T-02', seats: 4, sort_order: 2, is_active: true, section_id: null },
  { id: 't3', name: 'T-03', seats: 6, sort_order: 3, is_active: true, section_id: null },
];

const occupancy: Record<string, boolean> = { 'T-01': false, 'T-02': true, 'T-03': false };

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  tables,
  occupancy,
};

describe('TableSelectorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders grid of table cards when open', () => {
    render(<TableSelectorModal {...baseProps} />);
    expect(screen.getByText('T-01')).toBeInTheDocument();
    expect(screen.getByText('T-02')).toBeInTheDocument();
    expect(screen.getByText('T-03')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<TableSelectorModal {...baseProps} open={false} />);
    expect(screen.queryByText('T-01')).not.toBeInTheDocument();
  });

  it('shows seats count for each table', () => {
    render(<TableSelectorModal {...baseProps} />);
    expect(screen.getByText('2 seats')).toBeInTheDocument();
    expect(screen.getByText('4 seats')).toBeInTheDocument();
    expect(screen.getByText('6 seats')).toBeInTheDocument();
  });

  it('shows Free badge for unoccupied tables', () => {
    render(<TableSelectorModal {...baseProps} />);
    const freeBadges = screen.getAllByText('Free');
    expect(freeBadges.length).toBe(2);
  });

  it('shows Occupied badge for occupied tables', () => {
    render(<TableSelectorModal {...baseProps} />);
    expect(screen.getByText('Occupied')).toBeInTheDocument();
  });

  it('calls onSelect with table name and onClose when free table is tapped', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<TableSelectorModal {...baseProps} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Table T-01.*free/i }));
    expect(onSelect).toHaveBeenCalledWith('T-01');
    expect(onClose).toHaveBeenCalled();
  });

  it('fires toast.error and does not call onSelect when occupied table is tapped', () => {
    const onSelect = vi.fn();
    render(<TableSelectorModal {...baseProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Table T-02.*occupied/i }));
    expect(toast.error).toHaveBeenCalledWith('Table occupied');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('calls onSelect(null) and onClose when Skip button is tapped', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<TableSelectorModal {...baseProps} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /No table \/ Skip/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose only when Cancel (X) button is pressed', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<TableSelectorModal {...baseProps} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders empty grid when no tables provided', () => {
    render(<TableSelectorModal {...baseProps} tables={[]} />);
    expect(screen.queryByText('T-01')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No table \/ Skip/i })).toBeInTheDocument();
  });
});
