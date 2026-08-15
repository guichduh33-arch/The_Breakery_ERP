// apps/backoffice/src/features/reports/components/__tests__/BreakdownCard.smoke.test.tsx
//
// Lot C (campagne Reports 2026-08-15) — couvre l'extension ADDITIVE demandée par
// la page flagship : `shareBarPlacement` et le sous-titre de la barre de
// partage. Le placement n'est pas cosmétique — un total posé APRÈS la barre se
// lit comme le total de la barre, ce qu'il n'est pas.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BreakdownCard, type BreakdownRow } from '../BreakdownCard.js';

const rows: BreakdownRow[] = [
  { key: 'a', label: 'Viennoiserie', amount: 2_610_000, sharePct: 60 },
  { key: 'b', label: 'Bread',        amount: 1_740_000, sharePct: 40 },
];

const segments = [
  { label: 'Viennoiserie', pct: 60, color: 'var(--chart-1)' },
  { label: 'Bread',        pct: 40, color: 'var(--chart-3)' },
];

function renderCard(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('BreakdownCard — barre de partage', () => {
  it('par défaut, la barre précède le total (comportement du lot B, inchangé)', () => {
    const { container } = renderCard(
      <BreakdownCard
        title="Revenue by category"
        rows={rows}
        total="derived"
        shareBar={{ ariaLabel: 'Share of revenue', segments }}
      />,
    );
    const bar   = screen.getByTestId('breakdown-sharebar');
    const total = screen.getByText('Total');
    expect(bar.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[data-testid="breakdown-sharebar"] h3')).toBeNull();
  });

  it('`after-total` : la barre suit le total, sous son propre filet + sous-titre', () => {
    renderCard(
      <BreakdownCard
        title="Revenue by category"
        rows={rows}
        total="derived"
        shareBar={{ ariaLabel: 'Share of revenue', segments, title: 'Category share' }}
        shareBarPlacement="after-total"
      />,
    );
    const bar   = screen.getByTestId('breakdown-sharebar');
    const total = screen.getByText('Total');
    expect(total.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.className).toContain('border-t');
    expect(screen.getByRole('heading', { name: 'Category share', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Share of revenue' })).toBeInTheDocument();
  });

  it('sans segment, aucune barre — une barre vide affirmerait un partage nul', () => {
    renderCard(
      <BreakdownCard
        title="Revenue by category"
        rows={rows}
        total="derived"
        shareBar={{ ariaLabel: 'Share of revenue', segments: [] }}
        shareBarPlacement="after-total"
      />,
    );
    expect(screen.queryByTestId('breakdown-sharebar')).toBeNull();
  });
});
