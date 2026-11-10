// apps/backoffice/src/features/orders/__tests__/table-number-filter.test.tsx
//
// S3-22 — le filtre de table de la liste des commandes, depuis qu'il repose
// sur `DebouncedInput` : même libellé, même id, même testid, même émission.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { TableNumberFilter } from '../components/TableNumberFilter.js';
import { DEBOUNCED_COMMIT_MS } from '@/components/DebouncedInput.js';

afterEach(() => { vi.useRealTimers(); });

describe('TableNumberFilter', () => {
  it('keeps its label, id and testid', () => {
    render(<TableNumberFilter value="T-07" onCommit={() => { /* no-op */ }} />);
    const input = screen.getByLabelText('Table');
    expect(input).toBe(screen.getByTestId('orders-table-filter'));
    expect(input).toHaveAttribute('id', 'orders-table-number');
    expect(input).toHaveAttribute('maxLength', '32');
    expect(input).toHaveValue('T-07');
  });

  it('emits the trimmed table after the pause', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<TableNumberFilter value="" onCommit={onCommit} />);
    fireEvent.change(screen.getByTestId('orders-table-filter'), { target: { value: ' T-12 ' } });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(DEBOUNCED_COMMIT_MS); });
    expect(onCommit).toHaveBeenCalledWith('T-12');
  });

  it('emits an empty string when cleared, on Enter', () => {
    const onCommit = vi.fn();
    render(<TableNumberFilter value="T-07" onCommit={onCommit} />);
    const input = screen.getByTestId('orders-table-filter');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('');
  });
});
