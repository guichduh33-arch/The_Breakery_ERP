// S3-22 : hook réel, état URL et exports alignés sur les paires visibles.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockRpc = vi.fn();
const mockDownload = vi.fn();
const mockPdf = vi.fn();
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  rpc: (...args: unknown[]): unknown => mockRpc(...args),
} }));
vi.mock('@breakery/domain', async (load) => ({
  ...await load<Record<string, unknown>>(),
  downloadCsv: (...args: unknown[]): unknown => mockDownload(...args),
}));
vi.mock('@/features/reports/hooks/useGeneratePdf.js', () => ({
  useGeneratePdf: () => ({ mutateAsync: mockPdf, isPending: false }),
}));

import BasketAnalysisPage from '../BasketAnalysisPage.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { BasketPair } from '@/features/reports/hooks/useBasketAnalysis.js';

const RPC = 'get_basket_analysis_v7';
const PERIOD = '?start=2026-06-01&end=2026-06-07';
const FILTERS = '&order_type=dine_in&payment_method=cash&table_number=T-07';
const PAIRS: BasketPair[] = [
  { product_id_a: 'p1', product_a_name: 'Croissant', product_id_b: 'p2', product_b_name: 'Latte',
    co_occurrence_count: 12, support_a: 0.4, support_b: 0.3, support_pair: 0.24,
    confidence: 0.6, lift: 2 },
  { product_id_a: 'p3', product_a_name: 'Bagel', product_id_b: 'p4', product_b_name: 'Espresso',
    co_occurrence_count: 5, support_a: 0.25, support_b: 0.2, support_pair: 0.1,
    confidence: 0.4, lift: 2 },
  { product_id_a: 'p5', product_a_name: 'Crème bun', product_id_b: 'p6', product_b_name: 'Latte',
    co_occurrence_count: 3, support_a: 0.1, support_b: 0.3, support_pair: 0.06,
    confidence: 0.6, lift: 2 },
];

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}
function renderPage(search = PERIOD) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/backoffice/reports/basket-analysis${search}`]}>
      <BasketAnalysisPage /><LocationProbe />
    </MemoryRouter>
  </QueryClientProvider>);
}
function calls(): Record<string, unknown>[] {
  return mockRpc.mock.calls.filter(([fn]) => fn === RPC)
    .map(([, args]) => args as Record<string, unknown>);
}
function params(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('location').textContent ?? '');
}
async function ready(): Promise<void> {
  await screen.findByRole('link', { name: 'Croissant' });
  await waitFor(() => { expect(screen.getByTestId('export-menu')).toBeEnabled(); });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockRpc.mockReset().mockResolvedValue({ data: PAIRS, error: null });
  mockDownload.mockReset();
  mockPdf.mockReset().mockResolvedValue({ signed_url: 'https://example.invalid/basket.pdf' });
  vi.spyOn(window, 'open').mockReturnValue(null);
  sessionStorage.clear();
  useAuthStore.setState({ permissions: ['reports.export'] });
});

describe('Basket Analysis — filtres, table et exports', () => {
  it('conserve les arguments historiques sans filtre', async () => {
    renderPage(); await ready();
    expect(calls()).toEqual([{ p_date_start: '2026-06-01', p_date_end: '2026-06-07', p_top_n: 10 }]);
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('relit les trois filtres depuis un lien partagé', async () => {
    renderPage(PERIOD + FILTERS); await ready();
    expect(calls()[0]?.p_filters).toEqual({ order_type: 'dine_in', payment_method: 'cash', table_number: 'T-07' });
    expect(screen.getByLabelText('Order type')).toHaveValue('dine_in');
    expect(screen.getByLabelText('Payment method')).toHaveValue('cash');
    expect(screen.getByLabelText('Table')).toHaveValue('T-07');
    expect(screen.getByTestId('report-live')).toHaveTextContent('3 filters active');
    expect(screen.getByTestId('payment-filter-note')).toHaveTextContent(/counts in full/);
  });

  it.each([
    ['Order type', 'order_type', 'take_out'],
    ['Payment method', 'payment_method', 'qris'],
    ['Table', 'table_number', 'T-12'],
  ])('écrit %s dans l’URL et lit un cache distinct', async (label, key, value) => {
    renderPage(); await ready();
    const field = screen.getByLabelText(label);
    fireEvent.change(field, { target: { value } });
    if (key === 'table_number') fireEvent.blur(field);
    await waitFor(() => { expect(params().get(key)).toBe(value); });
    await waitFor(() => { expect(calls().at(-1)?.p_filters).toEqual({ [key]: value }); });
    expect(calls()).toHaveLength(2);
  });

  it('ignore les valeurs hors enums sans élargir une autre restriction', async () => {
    renderPage(PERIOD + '&order_type=drive_thru&payment_method=bitcoin&table_number=T-07');
    await ready();
    expect(calls()[0]?.p_filters).toEqual({ table_number: 'T-07' });
    expect(screen.getByLabelText('Order type')).toHaveValue('');
    expect(screen.getByLabelText('Payment method')).toHaveValue('');
  });

  it('efface filtres et recherche ensemble en gardant période et plafond', async () => {
    renderPage(PERIOD + FILTERS + '&q=Latte&top_n=25'); await ready();
    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => {
      expect(params().toString()).toBe('start=2026-06-01&end=2026-06-07&top_n=25');
    });
    expect(await screen.findByRole('searchbox', { name: 'Search pairs' })).toHaveValue('');
    await waitFor(() => { expect(calls().at(-1)).not.toHaveProperty('p_filters'); });
  });

  it('cherche sans accents et garde les KPI du jeu sélectionné', async () => {
    renderPage(PERIOD + '&q=creme');
    await screen.findByRole('link', { name: 'Crème bun' });
    expect(screen.queryByRole('link', { name: 'Croissant' })).toBeNull();
    expect(screen.getByTestId('basket-report-table-count')).toHaveTextContent('1 of 3 pairs');
    expect(screen.getByTestId('kpi-co-occurrences')).toHaveTextContent('20');
    expect(screen.getByTestId('kpi-co-occurrences')).toHaveTextContent('not unique baskets');
    expect(screen.queryByTestId('basket-report-table-footer')).toBeNull();
    expect(calls()).toHaveLength(1);
  });

  it('exporte les mêmes lignes cherchées et triées en CSV et PDF', async () => {
    renderPage(); await ready();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pairs' }), { target: { value: 'latte' } });
    const table = screen.getByTestId('basket-report-table');
    fireEvent.click(within(table).getByRole('button', { name: 'Co-occurrence' }));
    expect(params().get('q')).toBe('latte');
    const links = within(table).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Crème bun', 'Latte', 'Croissant', 'Latte']);
    fireEvent.click(screen.getByTestId('export-menu'));
    fireEvent.click(screen.getByTestId('export-csv'));
    await waitFor(() => { expect(mockDownload).toHaveBeenCalledOnce(); });
    const csv = mockDownload.mock.calls[0]?.[0] as string;
    expect(csv).not.toContain('Bagel');
    expect(csv.indexOf('Crème bun')).toBeLessThan(csv.indexOf('Croissant'));
    fireEvent.click(screen.getByTestId('export-menu'));
    fireEvent.click(screen.getByTestId('export-pdf'));
    await waitFor(() => { expect(mockPdf).toHaveBeenCalledOnce(); });
    expect(mockPdf.mock.calls[0]?.[0]).toMatchObject({
      template: 'basket', data: [PAIRS[2], PAIRS[0]],
      period: { start: '2026-06-01', end: '2026-06-07' },
    });
  });

  it('désactive l’export quand la recherche ne trouve rien et permet de l’effacer', async () => {
    renderPage(); await ready();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pairs' }), { target: { value: 'absent' } });
    await waitFor(() => { expect(screen.getByTestId('export-menu')).toBeDisabled(); });
    expect(screen.getByText('No pairs match “absent”.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('filters-clear'));
    await ready();
    expect(params().has('q')).toBe(false);
  });

  it('envoie un plafond entier même depuis une URL décimale', async () => {
    renderPage(PERIOD + '&top_n=12.5'); await ready();
    expect(calls()[0]?.p_top_n).toBe(12);
    expect(screen.getByRole('spinbutton', { name: 'Top N' })).toHaveValue(12);
  });

  it('ne réexporte pas les anciennes paires après un résultat serveur vide, même en cache', async () => {
    mockRpc.mockImplementation((_fn: string, args: { p_filters?: { order_type?: string } }) =>
      Promise.resolve({ data: args.p_filters?.order_type === 'take_out' ? [] : PAIRS, error: null }));
    renderPage(); await ready();
    const select = screen.getByLabelText('Order type');
    fireEvent.change(select, { target: { value: 'take_out' } });
    await screen.findByText('No paired sales');
    expect(screen.getByTestId('export-menu')).toBeDisabled();
    fireEvent.change(select, { target: { value: '' } });
    await ready();
    fireEvent.change(select, { target: { value: 'take_out' } });
    await screen.findByText('No paired sales');
    expect(screen.getByTestId('export-menu')).toBeDisabled();
    expect(calls()).toHaveLength(2);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockPdf).not.toHaveBeenCalled();
  });
});
