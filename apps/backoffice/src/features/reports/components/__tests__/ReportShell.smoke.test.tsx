// apps/backoffice/src/features/reports/components/__tests__/ReportShell.smoke.test.tsx
//
// Lot B (campagne Reports 2026-08-15) — l'ossature de l'archétype Report : fil
// d'Ariane, bandeau, bannière d'erreur UNIFIÉE (traduction permission_denied),
// EmptyState, et surtout : le contenu n'est plus enfermé dans une Card unique.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportShell } from '../ReportShell.js';

function renderShell(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ReportShell', () => {
  it('rend le fil d’Ariane par défaut Reports → titre', () => {
    renderShell(
      <ReportShell title="Daily Sales">
        <p>body</p>
      </ReportShell>,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Reports');
    const link = screen.getByRole('link', { name: 'Reports' });
    expect(link).toHaveAttribute('href', '/backoffice/reports');
    // Le dernier segment est la page courante, sans lien.
    expect(screen.queryByRole('link', { name: 'Daily Sales' })).toBeNull();
  });

  it('h1 unique via PageHeader + slot toolbar', () => {
    renderShell(
      <ReportShell title="Daily Sales" toolbar={<button type="button">Export</button>}>
        <p>body</p>
      </ReportShell>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Daily Sales');
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('erreur : bannière role=alert, corps et KPIs non rendus', () => {
    renderShell(
      <ReportShell title="R" error={new Error('permission_denied')} kpis={<div data-testid="kpis" />}>
        <p data-testid="body">body</p>
      </ReportShell>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You do not have permission to view this report.',
    );
    expect(screen.queryByTestId('body')).toBeNull();
    expect(screen.queryByTestId('kpis')).toBeNull();
  });

  it('vide : EmptyState à la place du corps', () => {
    renderShell(
      <ReportShell
        title="R"
        isEmpty
        emptyState={{ title: 'No data', description: 'Nothing in this window.' }}
      >
        <p data-testid="body">body</p>
      </ReportShell>,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByTestId('body')).toBeNull();
  });

  it('nominal : corps et KPIs posés sur la page (pas de Card englobante)', () => {
    renderShell(
      <ReportShell title="R" kpis={<div data-testid="kpis" />}>
        <p data-testid="body">body</p>
      </ReportShell>,
    );
    expect(screen.getByTestId('kpis')).toBeInTheDocument();
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });
});
