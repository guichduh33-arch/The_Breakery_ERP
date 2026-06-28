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

  it('disables continue until reason length >= 10 (step 1)', () => {
    render(wrap(<VoidZReportModal open zreportId="z1" onOpenChange={() => {}} />));
    const cont = screen.getByTestId('void-continue') as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('void-reason-input'), { target: { value: 'too short' } });
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('void-reason-input'), { target: { value: 'this is long enough' } });
    expect(cont.disabled).toBe(false);
  });

  it('S50 T5 — calls void_zreport_v2 with trimmed reason + manager PIN and closes on success', async () => {
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
    // Step 1 : reason -> continue
    fireEvent.change(screen.getByTestId('void-reason-input'), {
      target: { value: '  manager misclicked  ' },
    });
    fireEvent.click(screen.getByTestId('void-continue'));
    // Step 2 : PIN -> submit
    fireEvent.change(screen.getByTestId('void-pin-input'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('void-submit'));
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith(
        'void_zreport_v2',
        { p_zreport_id: 'z1', p_reason: 'manager misclicked', p_manager_pin: '123456' },
      ),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
