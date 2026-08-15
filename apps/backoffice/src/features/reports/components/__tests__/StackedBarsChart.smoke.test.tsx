// apps/backoffice/src/features/reports/components/__tests__/StackedBarsChart.smoke.test.tsx
//
// Lot E (campagne Reports 2026-08-15) — couverture de l'extension ADDITIVE
// `StackedBarsChart`, posée pour la COMPOSITION d'un total dans le temps
// (méthodes de paiement d'une journée, familles de coût d'une journée).
//
// Recharts ne dessine rien sous jsdom (conteneur de taille nulle) : le test
// porte sur l'ENVELOPPE — la figure est-elle NOMMÉE, garde-t-elle la hauteur du
// socle, et l'ordre des séries suit-il l'identité qu'on lui donne. Les barres
// elles-mêmes sont couvertes par les smoke tests de page.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StackedBarsChart, type StackedSeries } from '../charts/StackedBarsChart.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const DATA = [
  { day: '2026-06-01', cash: 1_000_000, qris: 500_000 },
  { day: '2026-06-02', cash:   800_000, qris: 700_000 },
];

const SERIES: StackedSeries[] = [
  { key: 'cash', name: 'Cash', color: 'var(--chart-1)' },
  { key: 'qris', name: 'Qris', color: 'var(--chart-3)' },
];

describe('StackedBarsChart', () => {
  it('rend une figure NOMMÉE, à la hauteur du socle', () => {
    render(
      <StackedBarsChart
        data={DATA}
        xKey="day"
        series={SERIES}
        ariaLabel="Daily collections stacked by payment method"
      />,
    );
    const fig = screen.getByRole('img', { name: 'Daily collections stacked by payment method' });
    expect(fig).toBeInTheDocument();
    expect(fig.className).toContain('h-72');
  });

  it('encaisse une série unique et un jeu vide sans perdre son étiquette', () => {
    const { rerender } = render(
      <StackedBarsChart
        data={DATA}
        xKey="day"
        series={[SERIES[0]!]}
        ariaLabel="One series only"
      />,
    );
    expect(screen.getByRole('img', { name: 'One series only' })).toBeInTheDocument();

    rerender(
      <StackedBarsChart data={[]} xKey="day" series={SERIES} ariaLabel="Nothing to stack" />,
    );
    expect(screen.getByRole('img', { name: 'Nothing to stack' })).toBeInTheDocument();
  });
});
