import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ExportButtons } from '../ExportButtons.js';
import { useAuthStore } from '@/stores/authStore.js';
import type * as DomainModule from '@breakery/domain';

// Mock @breakery/domain's downloadCsv (jsdom doesn't really download)
const downloadCsvSpy = vi.fn();
vi.mock('@breakery/domain', async (orig) => {
  const actual = await orig<typeof DomainModule>();
  return { ...actual, downloadCsv: (...args: unknown[]) => { downloadCsvSpy(...args); } };
});

// useGeneratePdf now calls the EF via a direct fetch (POS money-path pattern),
// not supabase.functions.invoke — so we mock the URL + token helper + global fetch.
vi.mock('@/lib/supabase.js', () => ({ supabaseUrl: 'http://test.local' }));
vi.mock('@/lib/accessToken.js', () => ({ getAccessToken: () => Promise.resolve('test-token') }));

const fetchMock = vi.fn();
Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

// Audit Reports 2026-08-01, lot C / D3 — <ExportButtons> ne rend rien sans
// `reports.export`, et les pages a export maison desactivent leur bouton. Ce
// test verifie le CABLAGE de l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
});

describe('ExportButtons', () => {
  beforeEach(() => {
    downloadCsvSpy.mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ signed_url: 'https://example.test/x', storage_path: 'reports-exports/x', expires_at: 'z' }),
    });
  });

  it('triggers CSV download with filename', () => {
    render(wrap(
      <ExportButtons csv={{
        rows: [{ a: 1 }],
        columns: [{ header: 'A', accessor: (r: { a: number }) => r.a }],
        filename: 'test-csv',
      }} />
    ));
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(downloadCsvSpy).toHaveBeenCalled();
    expect(downloadCsvSpy.mock.calls[0]?.[1]).toBe('test-csv');
  });

  it('triggers PDF EF call and opens signed_url', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(wrap(
      <ExportButtons pdf={{
        template: 'pnl',
        data: { revenue: { total: 100 } },
        period: { start: '2026-05-01', end: '2026-05-31' },
        filename: 'pnl-2026-05',
      }} />
    ));
    fireEvent.click(screen.getByTestId('export-pdf'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/functions/v1/generate-pdf',
      expect.objectContaining({ method: 'POST' }),
    ));
    const sentBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(sentBody).toMatchObject({ template: 'pnl', filename: 'pnl-2026-05' });
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://example.test/x', '_blank', 'noopener,noreferrer'));
    openSpy.mockRestore();
  });

  // Audit Reports 2026-08-01, lot C / D3 — `reports.export` sépare « consulter »
  // de « extraire ». Le CSV est construit côté client à partir de données déjà
  // reçues : masquer les boutons est le seul point de contrôle possible pour
  // lui (le PDF a en plus un verrou serveur dans l'EF generate-pdf).
  it('renders nothing when the caller lacks reports.export', () => {
    useAuthStore.setState({ permissions: [] });
    const { container } = render(wrap(
      <ExportButtons
        csv={{
          rows: [{ a: 1 }],
          columns: [{ header: 'A', accessor: (r: { a: number }) => r.a }],
          filename: 'test-csv',
        }}
        pdf={{
          template: 'pnl',
          data: { revenue: { total: 100 } },
          period: { start: '2026-05-01', end: '2026-05-31' },
          filename: 'pnl-2026-05',
        }}
      />
    ));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('export-csv')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).not.toBeInTheDocument();
  });

  it('renders both triggers once reports.export is granted', () => {
    useAuthStore.setState({ permissions: ['reports.export'] });
    render(wrap(
      <ExportButtons
        csv={{
          rows: [{ a: 1 }],
          columns: [{ header: 'A', accessor: (r: { a: number }) => r.a }],
          filename: 'test-csv',
        }}
        pdf={{
          template: 'pnl',
          data: { revenue: { total: 100 } },
          period: { start: '2026-05-01', end: '2026-05-31' },
          filename: 'pnl-2026-05',
        }}
      />
    ));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });
});
