import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const rpcSpy = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcSpy(...a),
    functions: { invoke: vi.fn() },
  },
}));

import { VoidZReportModal } from '../VoidZReportModal.js';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('VoidZReportModal', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    rpcSpy.mockResolvedValue({
      data: {
        zreport_id: 'z1',
        status: 'voided',
        voided_at: '2026-05-24T17:00:00Z',
        idempotent_replay: false,
      },
      error: null,
    });
  });

  it('disables submit until reason length >= 10', () => {
    render(wrap(<VoidZReportModal open zreportId="z1" onOpenChange={() => {}} />));
    const submit = screen.getByTestId('void-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('void-reason-input'), { target: { value: 'too short' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('void-reason-input'), { target: { value: 'this is long enough' } });
    expect(submit.disabled).toBe(false);
  });

  it('calls void_zreport_v1 with trimmed reason and closes on success', async () => {
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    render(wrap(
      <VoidZReportModal
        open
        zreportId="z1"
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
    ));
    fireEvent.change(screen.getByTestId('void-reason-input'), {
      target: { value: '  manager misclicked  ' },
    });
    fireEvent.click(screen.getByTestId('void-submit'));
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith(
        'void_zreport_v1',
        { p_zreport_id: 'z1', p_reason: 'manager misclicked' },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
