import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ExportButtons } from '../ExportButtons.js';

// Mock @breakery/domain's downloadCsv (jsdom doesn't really download)
const downloadCsvSpy = vi.fn();
vi.mock('@breakery/domain', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, downloadCsv: (...args: unknown[]) => downloadCsvSpy(...args) };
});

const invokeSpy = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeSpy(...args) } },
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('ExportButtons', () => {
  beforeEach(() => {
    downloadCsvSpy.mockClear();
    invokeSpy.mockClear();
    invokeSpy.mockResolvedValue({ data: { signed_url: 'https://example.test/x', storage_path: 'reports-exports/x', expires_at: 'z' }, error: null });
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
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledWith('generate-pdf', expect.objectContaining({
      body: expect.objectContaining({ template: 'pnl', filename: 'pnl-2026-05' }),
    })));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://example.test/x', '_blank', 'noopener,noreferrer'));
    openSpy.mockRestore();
  });
});
