// apps/backoffice/src/pages/reports/__tests__/WastagePage.smoke.test.tsx
//
// Lot F (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2. Ce fichier tient les acquis qui doivent survivre à la migration :
//
//  · la RPC reçoit des bornes MÉTIER (YYYY-MM-DD), et la période précédente est
//    requêtée quand la comparaison est méritée ;
//  · `lot_batch_number` et `reason`, câblés au lot A1 et jamais affichés, sont
//    désormais À L'ÉCRAN — colonne de lot, carte de ventilation par motif ;
//  · un lot absent est un tiret, pas un vide : les produits non lotés n'en
//    portent jamais, ce n'est pas une donnée manquante ;
//  · le total du pied reste celui de la PÉRIODE et non celui des lignes listées ;
//  · les deux exports restent atteignables (CSV + le gabarit PDF `wastage`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();
let truncated = false;

function wastagePayload() {
  return {
    period:  { start: '2026-04-25', end: '2026-05-25' },
    summary: {
      total_value: 150000,
      total_manual_waste_value: 60000,
      total_spoilage_value: 90000,
      total_qty: 17,
      line_count: 2,
    },
    by_product: [
      {
        product_id: 'p-1', product_name: 'Croissant',
        manual_waste_qty: 0, manual_waste_value: 0,
        spoilage_qty: 12, spoilage_value: 90000,
        total_qty: 12, total_value: 90000,
      },
      {
        product_id: 'p-2', product_name: 'Baguette',
        manual_waste_qty: 5, manual_waste_value: 60000,
        spoilage_qty: 0, spoilage_value: 0,
        total_qty: 5, total_value: 60000,
      },
    ],
    truncated,
    lines: [
      {
        id: 'w-1', product_id: 'p-1', product_name: 'Croissant',
        type: 'spoilage', qty: 12, value: 90000,
        created_at: '2026-05-20T08:00:00Z', created_by_name: null,
        lot_id: 'lot-1', lot_batch_number: 'B-2026-14', reason: 'Past best-before',
      },
      {
        id: 'w-2', product_id: 'p-2', product_name: 'Baguette',
        type: 'manual_waste', qty: 5, value: 60000,
        created_at: '2026-05-22T09:30:00Z', created_by_name: 'Ada',
        // Produit non loté, et saisie sans motif : les deux cas du tiret.
        lot_id: null, lot_batch_number: null, reason: null,
      },
    ],
  };
}

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_wastage_report_v2') {
        return Promise.resolve({ data: wastagePayload(), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import WastagePage from '@/pages/reports/WastagePage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2026-04-25&end=2026-05-25') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/wastage${search}`]}>
        <WastagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function wastageCalls(): { p_date_start: string; p_date_end: string }[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_wastage_report_v2')
    .map(([, args]) => args as { p_date_start: string; p_date_end: string });
}

/**
 * Attend la table CHARGÉE, pas la carte qui la contient. `findByTestId` sur une
 * PanelCard résout dès le montage — la carte existe pendant le chargement, son
 * corps n'est alors qu'un squelette. Un `getByText` juste après échouerait sans
 * réessayer.
 */
async function loadedLinesTable(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(within(screen.getByTestId('wastage-lines')).getAllByRole('row').length)
      .toBeGreaterThan(1);
  });
  return screen.getByTestId('wastage-lines');
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  truncated = false;
});

describe('WastagePage (smoke)', () => {
  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Wastage/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_wastage_report_v2 with business-date bounds', async () => {
    renderPage();
    await waitFor(() => {
      expect(wastageCalls().length).toBeGreaterThan(0);
    });
    for (const args of wastageCalls()) {
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(wastageCalls().some((a) => a.p_date_start === '2026-04-25')).toBe(true);
  });

  // La comparaison est méritée ici : une hausse des pertes est ce que l'écran
  // sert à voir. La période précédente doit donc être réellement requêtée.
  it('queries the previous period too, for the comparison', async () => {
    renderPage();
    await waitFor(() => {
      expect(wastageCalls().length).toBeGreaterThanOrEqual(2);
    });
    const windows = new Set(wastageCalls().map((a) => `${a.p_date_start}|${a.p_date_end}`));
    expect(windows.size).toBeGreaterThanOrEqual(2);
  });

  // Le nom paraît DEUX fois — sur l'axe du Pareto et dans la table. C'est la
  // règle data-viz (« étiquette directe »), pas un doublon : on porte donc
  // l'assertion sur la table.
  it('renders product rows once data loads', async () => {
    renderPage();
    const table = await loadedLinesTable();
    expect(within(table).getByText('Croissant')).toBeInTheDocument();
    expect(within(table).getByText('Baguette')).toBeInTheDocument();
  });

  // Le champ est câblé depuis le lot A1 et n'était affiché nulle part.
  it('shows the lot on the line that carries one, a dash on the one that does not', async () => {
    renderPage();
    const table = await loadedLinesTable();
    expect(within(table).getByText('B-2026-14')).toBeInTheDocument();
    const baguette = within(table).getAllByRole('row')
      .find((r) => r.textContent?.includes('Baguette'));
    expect(baguette).toBeDefined();
    // colonnes : Product | Lot | Type | Reason | Qty | Value | Date
    expect(baguette!.querySelectorAll('td')[1]?.textContent).toBe('—');
  });

  it('ventilates by reason, and names an unexplained write-off as such', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        within(screen.getByTestId('breakdown-wastage-reasons')).getByText('Past best-before'),
      ).toBeInTheDocument();
    });
    const card = screen.getByTestId('breakdown-wastage-reasons');
    expect(within(card).getByText('No reason given')).toBeInTheDocument();
  });

  it('renders the pareto of what weighs', async () => {
    renderPage();
    expect(await screen.findByTestId('chart-wastage-pareto')).toBeInTheDocument();
  });

  it('foots the table with the PERIOD total, not the listed lines', async () => {
    renderPage();
    const table = await loadedLinesTable();
    expect(within(table).getByText(/Total wastage value \(whole period\)/i)).toBeInTheDocument();
  });

  it('shows the truncation banner and says the total still covers the period', async () => {
    truncated = true;
    renderPage();
    const banner = await screen.findByTestId('wastage-truncated-banner');
    expect(banner.textContent).toMatch(/still covers the whole period/i);
  });

  it('offers CSV and PDF once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });
});
