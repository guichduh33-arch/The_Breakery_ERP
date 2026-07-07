import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const rpcSpy = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...a: unknown[]) => rpcSpy(...a) },
  supabaseUrl: 'http://test.local',
}));

// useGenerateZReportPdf now calls the EF via a direct fetch (POS money-path
// pattern), not supabase.functions.invoke.
vi.mock('@/lib/accessToken.js', () => ({ getAccessToken: async () => 'test-token' }));
const fetchMock = vi.fn();
Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

import { SignZReportModal } from '../SignZReportModal.js';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('SignZReportModal', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    fetchMock.mockReset();
    rpcSpy.mockResolvedValue({
      data: {
        id: 'z1',
        shift_id: 's1',
        generated_at: '2026-05-24T10:00:00Z',
        signed_at: null,
        signed_by: null,
        signed_by_name: null,
        voided_at: null,
        voided_by: null,
        void_reason: null,
        pdf_storage_path: null,
        status: 'draft',
        snapshot: {
          sales_total: 1500000,
          cash_variance: 0,
          opened_at: '2026-05-24T08:00:00Z',
          closed_at: '2026-05-24T16:00:00Z',
        },
      },
      error: null,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ signed_url: 'https://example.test/zreport', status: 'signed' }),
    });
  });

  it('renders preview step then PIN step, then calls sign + pdf and opens url', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    render(wrap(
      <SignZReportModal
        open
        zreportId="z1"
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
    ));

    await waitFor(() => expect(screen.getByTestId('sign-continue')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('sign-continue'));
    await waitFor(() => expect(screen.getByTestId('sign-pin-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('sign-pin-input'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('sign-submit'));

    await waitFor(() => expect(rpcSpy).toHaveBeenCalled());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/functions/v1/generate-zreport-pdf',
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith('https://example.test/zreport', '_blank', 'noopener,noreferrer'),
    );
    expect(onSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    openSpy.mockRestore();
  });

  it('rejects PIN that is not 6 digits', async () => {
    render(wrap(<SignZReportModal open zreportId="z1" onOpenChange={() => {}} />));
    await waitFor(() => screen.getByTestId('sign-continue'));
    fireEvent.click(screen.getByTestId('sign-continue'));
    await waitFor(() => screen.getByTestId('sign-pin-input'));
    fireEvent.change(screen.getByTestId('sign-pin-input'), { target: { value: '123' } });
    expect((screen.getByTestId('sign-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows QRIS/card variance rows only when that volet was counted (S67)', async () => {
    rpcSpy.mockResolvedValue({
      data: {
        id: 'z1',
        shift_id: 's1',
        generated_at: '2026-05-24T10:00:00Z',
        signed_at: null,
        signed_by: null,
        signed_by_name: null,
        voided_at: null,
        voided_by: null,
        void_reason: null,
        pdf_storage_path: null,
        status: 'draft',
        snapshot: {
          sales_total: 1500000,
          cash_variance: 0,
          opened_at: '2026-05-24T08:00:00Z',
          closed_at: '2026-05-24T16:00:00Z',
          reconciliation: {
            cash: { expected: 100000, counted: 100000, variance: 0 },
            qris: { expected: 50000, counted: 49000, variance: -1000 },
            card: { expected: null, counted: null, variance: null },
          },
        },
      },
      error: null,
    });
    render(wrap(<SignZReportModal open zreportId="z1" onOpenChange={() => {}} />));
    await waitFor(() => screen.getByTestId('sign-qris-variance'));
    expect(screen.getByTestId('sign-qris-variance')).toHaveTextContent('1.000');
    expect(screen.queryByTestId('sign-card-variance')).not.toBeInTheDocument();
  });
});
