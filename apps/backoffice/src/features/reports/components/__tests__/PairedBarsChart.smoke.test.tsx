// apps/backoffice/src/features/reports/components/__tests__/PairedBarsChart.smoke.test.tsx
//
// Lot D (campagne Reports 2026-08-15) — couverture de l'extension ADDITIVE
// `xTickAngle`, posée pour les axes de CATÉGORIES (noms de catégorie, noms de
// caissier) que la vague Sales trace. Ce que le test tient :
//
//  · le chemin par défaut (axe temporel) est INCHANGÉ — l'extension est
//    optionnelle et ne doit rien réécrire pour les pages du lot C ;
//  · la figure garde son étiquette accessible dans les deux cas : un graphe est
//    une image, et une image sans nom n'est pas lisible au lecteur d'écran.
//
// Recharts ne dessine rien sous jsdom (conteneur de taille nulle) : le test
// porte sur l'ENVELOPPE et sur l'absence de régression de rendu, pas sur les
// barres — celles-ci sont couvertes par les smoke tests de page.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PairedBarsChart } from '../charts/PairedBarsChart.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const DATA = [
  { label: 'Viennoiserie', current: 2_400_000, compare: 2_000_000 },
  { label: 'Boissons',     current:   600_000, compare:   700_000 },
];

describe('PairedBarsChart', () => {
  it('rend une figure NOMMÉE sur le chemin par défaut (aucun angle)', () => {
    render(
      <PairedBarsChart
        data={DATA}
        xKey="label"
        currentKey="current"
        currentName="This period"
        ariaLabel="Revenue per day"
      />,
    );
    const fig = screen.getByRole('img', { name: 'Revenue per day' });
    expect(fig).toBeInTheDocument();
    expect(fig.className).toContain('h-72');
  });

  it('accepte `xTickAngle` sans changer l’enveloppe ni perdre l’étiquette', () => {
    render(
      <PairedBarsChart
        data={DATA}
        xKey="label"
        currentKey="current"
        currentName="This period"
        compareKey="compare"
        compareName="Previous period"
        xTickAngle={-25}
        ariaLabel="Revenue per product category"
      />,
    );
    const fig = screen.getByRole('img', { name: 'Revenue per product category' });
    expect(fig).toBeInTheDocument();
    expect(fig.className).toContain('h-72');
  });
});
