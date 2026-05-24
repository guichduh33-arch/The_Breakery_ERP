import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeltaPct } from '../DeltaPct.js';

describe('DeltaPct', () => {
  it('renders +12.0% in green when current > previous', () => {
    render(<DeltaPct current={112} previous={100} />);
    const el = screen.getByTestId('delta-pct');
    expect(el).toHaveTextContent('+12.0%');
    expect(el.className).toContain('text-green-600');
  });

  it('renders -20.0% in red when current < previous', () => {
    render(<DeltaPct current={80} previous={100} />);
    const el = screen.getByTestId('delta-pct');
    expect(el).toHaveTextContent('-20.0%');
    expect(el.className).toContain('text-red-600');
  });

  it('renders em-dash when previous is 0', () => {
    render(<DeltaPct current={50} previous={0} />);
    expect(screen.getByTestId('delta-pct')).toHaveTextContent('—');
  });
});
