// apps/backoffice/src/features/reports/__tests__/ReportsIndexPage.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the rebuilt categorized hub.
// Session 40 / Wave C — updated: all 26 cards active, 0 Soon tiles.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReportsIndexPage from '@/pages/reports/ReportsIndexPage.js';

function renderPage() {
  return render(
    <MemoryRouter>
      <ReportsIndexPage />
    </MemoryRouter>,
  );
}

describe('ReportsIndexPage (rebuild)', () => {
  beforeEach(() => { cleanup(); });

  it('renders the new "Reports & Analytics" title', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Reports\s*&\s*Analytics/i);
  });

  it('renders all 7 section labels (Sales / Inventory / Purchases / Finance / Operations / Marketing / Logs)', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 2, name: /^Sales$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Inventory$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Purchases$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Finance/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Operations$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Marketing$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Logs/i })).toBeInTheDocument();
  });

  it('renders the Marketing section cards (D-D2 parity with sidebar)', () => {
    renderPage();
    // `../marketing/cohort` is resolved by react-router; at the test root it
    // becomes `/marketing/cohort` (in-app under /backoffice/reports it resolves
    // to /backoffice/marketing/cohort).
    expect(screen.getByText('Cohorts').closest('a')?.getAttribute('href')).toBe('/marketing/cohort');
    expect(screen.getByText('Segments').closest('a')).not.toBeNull();
    expect(screen.getByText('Promo ROI').closest('a')).not.toBeNull();
    expect(screen.getByText('Birthdays').closest('a')).not.toBeNull();
  });

  it('renders working report links for the implemented reports', () => {
    renderPage();
    // Sales by Hour is one of the implemented reports — should be a link.
    const link = screen.getByText(/Sales by Hour/i).closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/sales-by-hour');
  });

  it('has exactly 32 active card links (28 + 4 Marketing + 1 Gross Margin - 1 Perishable Turnover, S57 D-D2/B-D5, S61 D3.1)', () => {
    renderPage();
    // Every card is now an <a> element; disabled tiles are <div aria-disabled>.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(32);
  });

  it('has zero "Soon" disabled tiles after Wave C wiring', () => {
    renderPage();
    const disabled = document.querySelectorAll('[aria-disabled="true"]');
    expect(disabled).toHaveLength(0);
  });
});
