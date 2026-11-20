// S3-05 — contrat du crochet d'annulation de réception : appel RPC, réponse
// validée, refus traduits, clé d'idempotence stable entre deux essais.

import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCancelGoodsReceipt,
  cancelReceiptErrorMessage,
  classifyCancelReceiptError,
  CancelReceiptError,
  parseCancelReceiptDetails,
} from '../hooks/useCancelGoodsReceipt.js';

interface RpcArgs { p_grn_id: string; p_reason: string; p_idempotency_key: string }
const rpc = vi.hoisted(() => vi.fn<(fn: string, args: RpcArgs) => unknown>());
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

let client: QueryClient;
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const OK = {
  grn_id: 'grn-1', grn_number: 'GRN-1', po_id: 'po-1', previous_status: 'received',
  status: 'pending', movements_count: 2, reversal_je_id: 'je-2', reversed_je_id: 'je-1',
  cancelled_total: 660000, idempotent_replay: false,
};
const input = { grnId: 'grn-1', poId: 'po-1', reason: 'Wrong supplier' };

describe('useCancelGoodsReceipt', () => {
  beforeEach(() => {
    rpc.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(() => client.clear());

  it('calls cancel_goods_receipt_v1 and returns the validated result', async () => {
    rpc.mockResolvedValue({ data: OK, error: null });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCancelGoodsReceipt(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).resolves.toEqual(OK); });
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe('cancel_goods_receipt_v1');
    expect(args).toMatchObject({ p_grn_id: 'grn-1', p_reason: 'Wrong supplier' });
    expect(args.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(['purchase-order-detail', 'po-1']));
    expect(keys).toContain(JSON.stringify(['purchase-orders-bo']));
    expect(keys).toContain(JSON.stringify(['stock-levels']));
    expect(keys).toContain(JSON.stringify(['supplier-outstanding']));
    expect(keys).toContain(JSON.stringify(['reports']));
    expect(keys).toContain(JSON.stringify(['accounting']));
  });

  it('keeps the same idempotency key across retries, renews it after success', async () => {
    rpc.mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ data: { ...OK, idempotent_replay: true }, error: null })
      .mockResolvedValueOnce({ data: OK, error: null });
    const { result } = renderHook(() => useCancelGoodsReceipt(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('response lost'); });
    await act(async () => { await result.current.mutateAsync(input); });
    await act(async () => { await result.current.mutateAsync(input); });
    const k = rpc.mock.calls.map((c) => c[1].p_idempotency_key);
    expect(k[0]).toBe(k[1]);
    expect(k[2]).not.toBe(k[1]);
  });

  it('uses a fresh key when the next attempt targets another receipt', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'insufficient_stock_to_reverse: product=x stock=1 to_remove=2' } });
    const { result } = renderHook(() => useCancelGoodsReceipt(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toBeInstanceOf(CancelReceiptError); });
    await act(async () => { await expect(result.current.mutateAsync({ ...input, grnId: 'grn-2' })).rejects.toBeInstanceOf(CancelReceiptError); });
    expect(rpc.mock.calls[0]![1].p_idempotency_key).not.toBe(rpc.mock.calls[1]![1].p_idempotency_key);
  });

  it('rejects a malformed response instead of reporting a cancellation', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const { result } = renderHook(() => useCancelGoodsReceipt(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toMatchObject({ code: 'invalid_response' });
    });
  });

  it('translates the server refusals into English messages', async () => {
    const cases: [string, RegExp][] = [
      ['payments_exceed_remaining_receipts: paid=660000.00 remaining_received=0.00', /Settle the payment.*cash-on-delivery/],
      ['insufficient_stock_to_reverse: product=11111111-1111-1111-1111-111111111111 stock=2.000 to_remove=10.000', /already been used: Flour has 2 in stock but 10/],
      ['grn_already_cancelled', /already been cancelled/],
      ['historical_import_grn_not_cancellable', /historical import/],
      ['po_invalid_status: pending', /current status: pending/],
      ['period_locked: date 2026-11-20 falls in closed period', /accounting period/],
      ['forbidden', /permission/],
      ['received_quantity_inconsistent: po_item=x received=1 to_remove=2', /no longer matches/],
      ['receipt_line_quantity_missing: movement=22222222-2222-2222-2222-222222222222', /does not record how much was received/],
    ];
    for (const [message, expected] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error: { message } });
      const { result } = renderHook(() => useCancelGoodsReceipt(), { wrapper });
      let caught: unknown;
      await act(async () => { await result.current.mutateAsync(input).catch((e: unknown) => { caught = e; }); });
      expect(caught).toBeInstanceOf(CancelReceiptError);
      expect(cancelReceiptErrorMessage(caught as CancelReceiptError, 'Flour')).toMatch(expected);
    }
  });

  it('classifies and parses details from raw messages', () => {
    expect(classifyCancelReceiptError('idempotency_key_conflict')).toBe('idempotency_key_conflict');
    expect(classifyCancelReceiptError('something else')).toBe('unknown');
    expect(classifyCancelReceiptError('receipt_line_quantity_missing: movement=x'))
      .toBe('receipt_line_quantity_missing');
    expect(parseCancelReceiptDetails('payments_exceed_remaining_receipts: paid=500.00 remaining_received=100.00'))
      .toEqual({ paid: 500, remainingReceived: 100 });
  });
});
