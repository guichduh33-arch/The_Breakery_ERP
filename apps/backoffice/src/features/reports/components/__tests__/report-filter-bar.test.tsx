// apps/backoffice/src/features/reports/components/__tests__/report-filter-bar.test.tsx
//
// S3-22 — la barre de filtres partagée : chaque filtre s'écrit dans l'URL
// sous sa clé, se relit au montage, et « Clear filters » vide tout en une
// navigation. Le texte libre se commet en différé, pas à chaque frappe.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import { ReportFilterBar } from '../ReportFilterBar.js';
import { useReportFilters, type ReportFilterDef } from '../../hooks/useReportFilters.js';
import { DEBOUNCED_COMMIT_MS } from '@/components/DebouncedInput.js';

type Key = 'kind' | 'table';

const DEFS: readonly ReportFilterDef<Key>[] = [
  {
    kind: 'select', key: 'kind', label: 'Kind', allLabel: 'All kinds', strict: true,
    options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
  },
  { kind: 'text', key: 'table', label: 'Table', placeholder: 'Any', maxLength: 32 },
];

function Harness(): JSX.Element {
  const filters = useReportFilters(DEFS);
  const loc = useLocation();
  return (
    <>
      <ReportFilterBar defs={DEFS} filters={filters} />
      <span data-testid="location">{loc.search}</span>
      <span data-testid="active">{JSON.stringify(filters.active)}</span>
    </>
  );
}

const EXTRA = ['q'] as const;

function HarnessExtra(): JSX.Element {
  const filters = useReportFilters(DEFS, { extraKeys: EXTRA });
  const loc = useLocation();
  return (
    <>
      <ReportFilterBar defs={DEFS} filters={filters} />
      <span data-testid="location">{loc.search}</span>
    </>
  );
}

// Liste non stricte (chargée à la volée dans les pages) : la valeur d'URL
// s'applique même hors options.
const LOOSE: readonly ReportFilterDef<'cat'>[] = [
  { kind: 'select', key: 'cat', label: 'Category', allLabel: 'All categories',
    options: [{ value: 'x', label: 'Xylo' }] },
];

function HarnessLoose(): JSX.Element {
  const filters = useReportFilters(LOOSE);
  const loc = useLocation();
  return (
    <>
      <ReportFilterBar defs={LOOSE} filters={filters} />
      <span data-testid="location">{loc.search}</span>
      <span data-testid="active">{JSON.stringify(filters.active)}</span>
    </>
  );
}

function renderBar(search = '', extra = false) {
  return render(
    <MemoryRouter initialEntries={[`/r${search}`]}>
      {extra ? <HarnessExtra /> : <Harness />}
    </MemoryRouter>,
  );
}

afterEach(() => { vi.useRealTimers(); });

describe('ReportFilterBar', () => {
  it('labels every control and groups them', () => {
    renderBar();
    expect(screen.getByRole('group', { name: 'Report filters' })).toBeInTheDocument();
    expect(screen.getByLabelText('Kind')).toBe(screen.getByTestId('filter-kind'));
    expect(screen.getByLabelText('Table')).toBe(screen.getByTestId('filter-table'));
  });

  it('reads the filters from the URL on mount', () => {
    renderBar('?kind=b&table=T-07&other=1');
    expect(screen.getByTestId('filter-kind')).toHaveValue('b');
    expect(screen.getByTestId('filter-table')).toHaveValue('T-07');
    expect(screen.getByTestId('active')).toHaveTextContent('{"kind":"b","table":"T-07"}');
  });

  it('a strict list ignores a value outside its options', () => {
    renderBar('?kind=zzz');
    expect(screen.getByTestId('active')).toHaveTextContent('{}');
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('writes a list choice to the URL under its key, and removes it when reset', () => {
    renderBar();
    fireEvent.change(screen.getByTestId('filter-kind'), { target: { value: 'a' } });
    expect(screen.getByTestId('location')).toHaveTextContent('?kind=a');
    fireEvent.change(screen.getByTestId('filter-kind'), { target: { value: '' } });
    expect(screen.getByTestId('location')).toHaveTextContent(/^$/);
  });

  it('commits free text after the pause, trimmed, not on every keystroke', () => {
    vi.useFakeTimers();
    renderBar();
    const input = screen.getByTestId('filter-table');
    fireEvent.change(input, { target: { value: ' T-1' } });
    fireEvent.change(input, { target: { value: ' T-12 ' } });
    expect(screen.getByTestId('location')).toHaveTextContent(/^$/);
    act(() => { vi.advanceTimersByTime(DEBOUNCED_COMMIT_MS); });
    expect(screen.getByTestId('location')).toHaveTextContent('?table=T-12');
    // La frappe en cours n'est pas écrasée par l'écho de l'URL.
    expect(input).toHaveValue(' T-12 ');
  });

  it('commits free text immediately on Enter', () => {
    renderBar();
    const input = screen.getByTestId('filter-table');
    fireEvent.change(input, { target: { value: 'T-3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent('?table=T-3');
  });

  it('shows Clear filters only when a filter is active, and clears all of them', () => {
    renderBar('?kind=a&table=T-07&start=2026-06-01');
    const clear = screen.getByTestId('filters-clear');
    expect(clear).toHaveAccessibleName('Clear filters');
    fireEvent.click(clear);
    expect(screen.getByTestId('location')).toHaveTextContent('?start=2026-06-01');
    expect(screen.getByTestId('filter-kind')).toHaveValue('');
    expect(screen.getByTestId('filter-table')).toHaveValue('');
    expect(screen.queryByTestId('filters-clear')).toBeNull();
    // Le bouton a disparu : le focus revient au premier contrôle.
    expect(screen.getByTestId('filter-kind')).toHaveFocus();
  });

  it('extra keys alone show Clear filters, and are removed in the same navigation', () => {
    renderBar('?q=bag&start=2026-06-01', true);
    fireEvent.click(screen.getByTestId('filters-clear'));
    expect(screen.getByTestId('location')).toHaveTextContent('?start=2026-06-01');
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('an extra key without the option does not count as a filter', () => {
    renderBar('?q=bag');
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('a strict list shows no fallback option for a value outside its options', () => {
    renderBar('?kind=zzz');
    expect(screen.getByTestId('filter-kind')).toHaveValue('');
    expect(screen.queryByTestId('filter-kind-unknown')).toBeNull();
  });

  it('a non-strict list keeps an unknown active value visible, and removable', () => {
    render(
      <MemoryRouter initialEntries={['/r?cat=gone&start=2026-06-01']}>
        <HarnessLoose />
      </MemoryRouter>,
    );
    const select = screen.getByTestId('filter-cat');
    expect(select).toHaveValue('gone');
    expect(screen.getByTestId('filter-cat-unknown')).toHaveTextContent('Unknown (not in list)');
    expect(screen.getByTestId('active')).toHaveTextContent('{"cat":"gone"}');
    fireEvent.click(screen.getByTestId('filters-clear'));
    expect(screen.getByTestId('location')).toHaveTextContent('?start=2026-06-01');
    expect(select).toHaveValue('');
    expect(screen.queryByTestId('filter-cat-unknown')).toBeNull();
  });

  it('a non-strict list adds no fallback when the value is listed', () => {
    render(
      <MemoryRouter initialEntries={['/r?cat=x']}>
        <HarnessLoose />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('filter-cat')).toHaveValue('x');
    expect(screen.queryByTestId('filter-cat-unknown')).toBeNull();
  });

  it('clearing cancels a pending text commit', () => {
    vi.useFakeTimers();
    renderBar('?kind=a');
    fireEvent.change(screen.getByTestId('filter-table'), { target: { value: 'T-9' } });
    fireEvent.click(screen.getByTestId('filters-clear'));
    act(() => { vi.advanceTimersByTime(DEBOUNCED_COMMIT_MS * 2); });
    expect(screen.getByTestId('location')).not.toHaveTextContent('table=');
  });
});
