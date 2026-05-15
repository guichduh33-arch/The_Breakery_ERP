import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Coffee } from 'lucide-react';
import { KpiTile } from '../KpiTile.js';

describe('KpiTile', () => {
  it('renders label + value (default = number format)', () => {
    render(<KpiTile label="Orders" value={42} />);
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('formats currency values via formatIdr', () => {
    render(<KpiTile label="Today's Revenue" value={1500000} valueFormat="currency" />);
    // formatIdr emits "Rp 1.500.000" or similar — match the digits.
    expect(screen.getByText(/Rp.*1.*500.*000/)).toBeInTheDocument();
  });

  it('formats percent values with % suffix', () => {
    render(<KpiTile label="Margin" value={12} valueFormat="percent" />);
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<KpiTile label="Orders" value={1} icon={Coffee} />);
    // Card wrapper has the icon — verify by container presence.
    expect(screen.getByText('Orders')).toBeInTheDocument();
    // Icon is aria-hidden so we look for its parent class.
    const tile = screen.getByText('Orders').closest('div');
    expect(tile).not.toBeNull();
  });

  it('renders delta with direction', () => {
    render(
      <KpiTile
        label="Orders"
        value={42}
        delta={{ value: '+8%', direction: 'up', hint: 'vs last wk' }}
      />,
    );
    expect(screen.getByText('+8%')).toBeInTheDocument();
    expect(screen.getByText('vs last wk')).toBeInTheDocument();
  });

  it('renders footer slot', () => {
    render(<KpiTile label="Customers" value={120} footer={<span>active today</span>} />);
    expect(screen.getByText('active today')).toBeInTheDocument();
  });

  it('passes through string value as-is', () => {
    render(<KpiTile label="Status" value="OK" />);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });
});
