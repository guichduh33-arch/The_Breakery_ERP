import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangePickerWithCompare } from '../DateRangePickerWithCompare.js';

describe('DateRangePickerWithCompare', () => {
  it('renders both date inputs + compare toggle', () => {
    render(
      <DateRangePickerWithCompare
        start="2026-05-01"
        end="2026-05-31"
        onStartChange={() => {}}
        onEndChange={() => {}}
        compare={false}
        onCompareChange={() => {}}
      />
    );
    expect(screen.getByTestId('compare-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('compare-toggle')).not.toBeChecked();
  });

  it('fires onCompareChange when toggled', () => {
    const onChange = vi.fn();
    render(
      <DateRangePickerWithCompare
        start="2026-05-01"
        end="2026-05-31"
        onStartChange={() => {}}
        onEndChange={() => {}}
        compare={false}
        onCompareChange={onChange}
      />
    );
    fireEvent.click(screen.getByTestId('compare-toggle'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
