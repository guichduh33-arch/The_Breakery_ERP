// apps/backoffice/src/__tests__/charts-accessible-name.test.tsx
//
// Audit P2-5 (WCAG 1.1.1) — un graphe recharts est un <svg> sans equivalent
// textuel : au lecteur d'ecran il n'existe pas. Le conteneur porte donc
// role="img" + un aria-label qui DECRIT les donnees, comme les pages de
// pages/reports/ le font deja.
//
// Trois composants representatifs, choisis parce qu'ils couvrent les trois
// formes de pose du nom : conteneur nu (RevenueTrendChart), conteneur nu avec
// deux montants dans le libelle (SupplierPaymentDistribution), et conteneur
// enveloppe pour ne pas masquer le titre visible (SalesVelocityChart).
//
// ResizeObserver est deja polyfille par vitest.setup.ts : en jsdom le graphe a
// une largeur nulle, mais le nom accessible vit sur le conteneur, pas sur le SVG.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { RevenueTrendChart } from '@/features/dashboard/components/RevenueTrendChart.js';
import { SalesVelocityChart } from '@/features/inventory-dashboard/components/SalesVelocityChart.js';
import { SupplierPaymentDistribution } from '@/features/suppliers/components/SupplierPaymentDistribution.js';

afterEach(cleanup);

describe('accessible names of back-office charts', () => {
  it('RevenueTrendChart names the series and the compared window', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      net: 100_000 + i,
      prev_net: 90_000 + i,
    }));
    render(<RevenueTrendChart data={data} />);

    expect(
      screen.getByRole('img', {
        name: 'Line chart of net revenue over the last 30 days, compared with the previous 30 days.',
      }),
    ).toBeInTheDocument();
  });

  it('SupplierPaymentDistribution names both amounts of the split', () => {
    render(<SupplierPaymentDistribution paidAmount={1_500_000} overdueAmount={250_000} />);

    const chart = screen.getByRole('img', { name: /Donut chart of supplier payment distribution/ });
    expect(chart).toBeInTheDocument();
    expect(chart.getAttribute('aria-label')).toMatch(/paid versus/);
  });

  it('SalesVelocityChart names the chart without swallowing its visible title', () => {
    const data = [
      { day: '2026-07-01', units_sold: 12 },
      { day: '2026-07-02', units_sold: 8 },
      { day: '2026-07-03', units_sold: 15 },
    ];
    render(<SalesVelocityChart data={data} unit="kg" />);

    expect(
      screen.getByRole('img', {
        name: 'Bar chart of daily sales and production-out in kg over 3 days.',
      }),
    ).toBeInTheDocument();
    // Le titre reste dans l'arbre d'accessibilite : role="img" rend feuille le
    // conteneur qui le porte, jamais la carte entiere.
    expect(screen.getByText(/Daily sales \/ production-out/)).toBeInTheDocument();
  });
});
