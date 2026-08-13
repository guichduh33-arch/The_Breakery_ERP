// apps/backoffice/src/pages/reports/__tests__/ReportsIndexPage.search.test.tsx
//
// Audit UX/UI 2026-08-13, lot 5 — le hub Reports devient navigable en 90 s.
// Trois comportements sous contrat : la recherche réduit les tuiles ET fait
// disparaître les sections vides, un cul-de-sac rend un état vide sortable,
// et la bande « Recently viewed » apparaît après un clic sur une tuile.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ReportsIndexPage from '@/pages/reports/ReportsIndexPage.js';
import {
  RECENT_REPORTS_KEY,
  readRecentReports,
  pushRecentReport,
  MAX_RECENT_REPORTS,
} from '@/pages/reports/recentReports.js';

function renderHub() {
  return render(
    <MemoryRouter initialEntries={['/backoffice/reports']}>
      <ReportsIndexPage />
    </MemoryRouter>,
  );
}

/** Une tuile = un lien. Le bandeau de titre n'en porte aucun. */
function tileCount(): number {
  return screen.queryAllByRole('link').length;
}

function search(text: string): void {
  fireEvent.change(screen.getByLabelText('Find a report'), { target: { value: text } });
}

/** La `<section>` qui porte la bande des récents. */
function recentBand(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /Recently viewed/ });
  const section = heading.closest('section');
  if (section === null) throw new Error('Recently viewed heading has no <section> ancestor');
  return section;
}

beforeEach(() => {
  localStorage.clear();
});

describe('ReportsIndexPage — search', () => {
  it('has a programmatic label on the search field', () => {
    renderHub();
    expect(screen.getByLabelText('Find a report')).toBeInTheDocument();
  });

  it('narrows the tiles and drops the sections that no longer match', () => {
    renderHub();

    const before = tileCount();
    expect(before).toBeGreaterThan(20);
    expect(screen.getByRole('heading', { name: 'Finance & Payments' })).toBeInTheDocument();

    search('wastage');

    expect(tileCount()).toBeLessThan(before);
    expect(screen.getByRole('link', { name: /Wastage & Spoilage/ })).toBeInTheDocument();
    // La section Inventory survit, celle de Finance disparaît entièrement.
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Finance & Payments' })).toBeNull();
  });

  it('matches the blurb, not only the title', () => {
    renderHub();

    // « QRIS » n'apparaît dans aucun titre — seulement dans des blurbs.
    search('qris');

    expect(screen.getByRole('link', { name: /Payment by Method/ })).toBeInTheDocument();
    expect(tileCount()).toBeLessThan(5);
  });

  it('ignores case and accents', () => {
    renderHub();

    search('BÁLANCE');

    expect(screen.getByRole('link', { name: /Balance Sheet/ })).toBeInTheDocument();
  });

  it('shows an empty state with a working "Clear search" way out', () => {
    renderHub();
    const all = tileCount();

    search('zzzznothing');

    expect(tileCount()).toBe(0);
    expect(screen.getByText('No report matches')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(screen.queryByText('No report matches')).toBeNull();
    expect(tileCount()).toBe(all);
    expect(screen.getByLabelText('Find a report')).toHaveValue('');
  });
});

describe('ReportsIndexPage — recently viewed', () => {
  it('is absent until a tile has been opened, then leads the page', () => {
    const { unmount } = renderHub();

    expect(screen.queryByRole('heading', { name: /Recently viewed/ })).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: /Wastage & Spoilage/ }));

    expect(
      within(recentBand()).getByRole('link', { name: /Wastage & Spoilage/ }),
    ).toBeInTheDocument();

    // Persisté par poste : un remontage relit le stockage.
    expect(readRecentReports()).toEqual(['wastage']);
    unmount();
    renderHub();
    expect(screen.getByRole('heading', { name: /Recently viewed/ })).toBeInTheDocument();
  });

  it('drops stored targets that no longer resolve to a tile', () => {
    localStorage.setItem(
      RECENT_REPORTS_KEY,
      JSON.stringify(['route-that-was-deleted', 'wastage']),
    );
    renderHub();

    expect(within(recentBand()).getAllByRole('link')).toHaveLength(1);
  });

  it('hides the band when the search excludes every recent report', () => {
    localStorage.setItem(RECENT_REPORTS_KEY, JSON.stringify(['wastage']));
    renderHub();

    expect(screen.getByRole('heading', { name: /Recently viewed/ })).toBeInTheDocument();

    search('balance');

    expect(screen.queryByRole('heading', { name: /Recently viewed/ })).toBeNull();
  });
});

describe('recentReports store', () => {
  it('keeps the most recent first, deduplicates and caps the list', () => {
    for (const to of ['a', 'b', 'c', 'd', 'e', 'f']) pushRecentReport(to);
    expect(readRecentReports()).toEqual(['f', 'e', 'd', 'c', 'b']);
    expect(readRecentReports()).toHaveLength(MAX_RECENT_REPORTS);

    pushRecentReport('c');
    expect(readRecentReports()).toEqual(['c', 'f', 'e', 'd', 'b']);
  });

  it('reads an empty history rather than throwing on corrupt or hostile data', () => {
    localStorage.setItem(RECENT_REPORTS_KEY, 'not json at all');
    expect(readRecentReports()).toEqual([]);

    localStorage.setItem(RECENT_REPORTS_KEY, JSON.stringify({ to: 'wastage' }));
    expect(readRecentReports()).toEqual([]);

    localStorage.setItem(RECENT_REPORTS_KEY, JSON.stringify(['wastage', 42, null]));
    expect(readRecentReports()).toEqual(['wastage']);
  });

  it('survives a localStorage that refuses to write', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new Error('QuotaExceededError'); });
    try {
      expect(pushRecentReport('wastage')).toEqual(['wastage']);
    } finally {
      setItem.mockRestore();
    }
  });
});
