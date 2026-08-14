// apps/backoffice/src/components/kpi/__tests__/KpiTile.test.tsx
//
// Lot B (campagne Reports 2026-08-15) — la tuile partagée extraite de
// DashboardKpiStrip : héro encre, tuile-lien dont la BOÎTE est le lien, tuile
// inerte sans lien mort.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KpiTile } from '../KpiTile.js';

function renderTile(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('KpiTile', () => {
  it('rend label, valeur et infobulle du montant exact', () => {
    renderTile(
      <KpiTile label="Net revenue" value="Rp 8,42 jt" valueTitle="Rp 8.424.000" testId="tile" />,
    );
    expect(screen.getByText('Net revenue')).toBeInTheDocument();
    expect(screen.getByText('Rp 8,42 jt')).toHaveAttribute('title', 'Rp 8.424.000');
  });

  it('héro : fond encre et valeur 26 px', () => {
    renderTile(<KpiTile label="Net revenue" value="Rp 8,42 jt" hero testId="tile" />);
    const tile = screen.getByTestId('tile');
    expect(tile.className).toContain('bg-ink');
    expect(screen.getByText('Rp 8,42 jt').className).toContain('text-[26px]');
  });

  it('avec `to`, la boîte entière est un lien et la destination est annoncée en sr-only', () => {
    renderTile(
      <KpiTile
        label="Orders"
        value="247"
        to="/backoffice/orders"
        srHint="Open the orders list for this period"
        testId="tile"
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('data-testid', 'tile');
    expect(link).toHaveAttribute('href', '/backoffice/orders');
    expect(screen.getByText('Open the orders list for this period')).toHaveClass('sr-only');
  });

  it('sans `to`, aucune trace de lien', () => {
    renderTile(<KpiTile label="Orders" value="247" testId="tile" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
