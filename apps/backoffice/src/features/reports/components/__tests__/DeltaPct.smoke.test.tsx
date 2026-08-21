import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeltaPct } from '../DeltaPct.js';

// La VIRGULE de « +12,0% » n'est pas une coquille : c'est la décimale de la
// locale métier (id-ID), celle des montants. Ces assertions attendaient un
// POINT tant que le composant passait par `toFixed()` — et le point est déjà le
// séparateur de milliers d'un « Rp 3.257.500 » affiché deux lignes plus haut.
// Voir `formatPercent` dans `packages/utils/src/format.ts`.
describe('DeltaPct', () => {
  it('renders +12,0% in green when current > previous', () => {
    render(<DeltaPct current={112} previous={100} />);
    const el = screen.getByTestId('delta-pct');
    expect(el).toHaveTextContent('+12,0%');
    expect(el.className).toContain('text-success');
  });

  it('renders -20,0% in red when current < previous', () => {
    render(<DeltaPct current={80} previous={100} />);
    const el = screen.getByTestId('delta-pct');
    expect(el).toHaveTextContent('-20,0%');
    expect(el.className).toContain('text-danger');
  });

  it('renders em-dash when previous is 0', () => {
    render(<DeltaPct current={50} previous={0} />);
    expect(screen.getByTestId('delta-pct')).toHaveTextContent('—');
  });
});
