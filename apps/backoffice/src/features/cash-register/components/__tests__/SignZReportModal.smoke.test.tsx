import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const rpcSpy = vi.fn();
const invokeSpy = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcSpy(...a),
    functions: { invoke: (...a: unknown[]) => invokeSpy(...a) },
  },
}));

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
    invokeSpy.mockClear();
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
    invokeSpy.mockResolvedValue({
      data: { signed_url: 'https://example.test/zreport', status: 'signed' },
      error: null,
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
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledWith('generate-zreport-pdf', expect.anything()));
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
});
