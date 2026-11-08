import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecordProduction } from '../hooks/useRecordProduction.js';
import { useRecordBatchProduction } from '../hooks/useRecordBatchProduction.js';
import { submitProduction, type KitchenRequest } from '../../kitchen/api.js';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

let client: QueryClient;
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const unitInput = {
  productId: 'bread', quantityProduced: 12, sectionId: 'bakery', idempotencyKey: 'unit-key',
};
const batchInput = {
  sectionId: 'bakery', idempotencyKey: 'batch-key',
  items: [{ productId: 'bread', quantityProduced: 12 }],
};
const shortages = [{ material_id: 'flour', required: 2, available: 1, shortfall: 1, unit: 'kg' }];

describe('published production RPC callers', () => {
  beforeEach(() => {
    rpc.mockReset();
    client = new QueryClient({ defaultOptions: {
      queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 },
    } });
  });
  afterEach(() => client.clear());

  it('preserves unit production quantities, waste, yields, key and returned number beyond four digits', async () => {
    const receipt = { production_id: 'production', production_number: 'PROD-20261108-10011',
      lot_id: null, movements_count: 2, je_count: 2, idempotent_replay: true };
    rpc.mockResolvedValue({ data: receipt, error: null });
    const { result } = renderHook(() => useRecordProduction(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ ...unitInput, batchNumber: 'manual-batch',
        quantityWaste: 2, wasteReason: 'mis_baked', notes: 'Oven stopped',
        expectedYieldQty: 14, actualYieldQty: 0, yieldVarianceReason: 'Oven stopped',
        forceNegative: true,
      })).resolves.toBe(receipt);
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_production_v11', {
      p_product_id: 'bread', p_quantity_produced: 12, p_section_id: 'bakery',
      p_idempotency_key: 'unit-key', p_batch_number: 'manual-batch', p_quantity_waste: 2,
      p_waste_reason: 'mis_baked', p_notes: 'Oven stopped', p_expected_yield_qty: 14,
      p_actual_yield_qty: 0, p_yield_variance_reason: 'Oven stopped', p_force_negative: true,
    });
  });

  it.each([undefined, false])('does not force unit production when forceNegative is %s', async forceNegative => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useRecordProduction(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...unitInput, ...(forceNegative === undefined ? {} : { forceNegative }) });
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_production_v11', {
      p_product_id: 'bread', p_quantity_produced: 12, p_section_id: 'bakery',
      p_quantity_waste: 0, p_idempotency_key: 'unit-key',
    });
  });

  it('refuses an empty unit station before any RPC', async () => {
    const { result } = renderHook(() => useRecordProduction(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ ...unitInput, sectionId: '' }))
        .rejects.toMatchObject({ name: 'RecordProductionError', code: 'section_required' });
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['insufficient_stock', 'force_negative_forbidden'])(
    'propagates the unit %s rejection and shortage details without retrying', async code => {
      rpc.mockResolvedValue({ data: null, error: { message: code, details: JSON.stringify(shortages) } });
      const { result } = renderHook(() => useRecordProduction(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync({ ...unitInput, forceNegative: true }))
          .rejects.toMatchObject({ name: 'RecordProductionError', code, missingDetail: shortages });
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves the batch date, both idempotency keys, each item and server replay receipt', async () => {
    const receipt = { batch_id: 'batch', batch_number: 'BATCH-20261108-10011',
      status: 'completed', production_records: [], idempotent_replay: true };
    rpc.mockResolvedValue({ data: receipt, error: null });
    const { result } = renderHook(() => useRecordBatchProduction(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ ...batchInput, notes: 'Late entry',
        productionDate: '2026-11-07T06:00:00+08:00', forceNegative: true,
        items: [{ productId: 'bread', quantityProduced: 12, quantityWaste: 2,
          wasteReason: 'mis_baked', expectedYieldQty: 14, actualYieldQty: 0,
          yieldVarianceReason: 'Oven stopped', idempotencyKey: 'line-key' },
        { productId: 'cake', quantityProduced: 3, quantityWaste: 0 }],
      })).resolves.toBe(receipt);
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_batch_production_v13', {
      p_batch: { section_id: 'bakery', idempotency_key: 'batch-key', notes: 'Late entry',
        production_date: '2026-11-07T06:00:00+08:00', force_negative: true },
      p_items: [{ product_id: 'bread', quantity_produced: 12, quantity_waste: 2,
        waste_reason: 'mis_baked', expected_yield_qty: 14, actual_yield_qty: 0,
        yield_variance_reason: 'Oven stopped', idempotency_key: 'line-key' },
      { product_id: 'cake', quantity_produced: 3, quantity_waste: 0 }],
    });
  });

  it.each([undefined, false])('omits force and blank date from the batch when forceNegative is %s', async forceNegative => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { result } = renderHook(() => useRecordBatchProduction(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...batchInput, productionDate: '',
        ...(forceNegative === undefined ? {} : { forceNegative }) });
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_batch_production_v13', {
      p_batch: { section_id: 'bakery', idempotency_key: 'batch-key' },
      p_items: [{ product_id: 'bread', quantity_produced: 12 }],
    });
  });

  it.each(['insufficient_stock', 'force_negative_forbidden'])(
    'propagates the batch %s rejection and shortage details without retrying', async code => {
      rpc.mockResolvedValue({ data: null, error: { message: code, details: JSON.stringify(shortages) } });
      const { result } = renderHook(() => useRecordBatchProduction(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync({ ...batchInput, forceNegative: true }))
          .rejects.toMatchObject({ name: 'RecordBatchProductionError', code, missingDetail: shortages });
      });
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  const kitchenRequest: KitchenRequest = {
    idempotency_key: 'kitchen-key', section_id: 'bakery', day: '2026-11-08',
    items: [{ product_id: 'bread', unit: 'dozen', quantity_produced: 2, quantity_waste: 0,
      waste_reason: '', note: 'Morning production' }],
  };
  it('sends the exact kitchen request with its unit, day and key and returns the server receipt', async () => {
    const receipt = { batch_id: 'batch', batch_number: 'BATCH-20261108-10012', idempotent_replay: true };
    rpc.mockResolvedValue({ data: receipt, error: null });
    await expect(submitProduction(kitchenRequest)).resolves.toBe(receipt);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_kitchen_production_v6', { p_request: kitchenRequest });
    const args = rpc.mock.calls[0]?.[1] as { p_request: KitchenRequest };
    expect(args.p_request).toBe(kitchenRequest);
  });

  it('propagates the exact kitchen refusal without retrying or changing the saved request', async () => {
    const error = { code: 'P0001', message: 'idempotency_payload_mismatch' };
    const savedRequest = structuredClone(kitchenRequest);
    rpc.mockResolvedValue({ data: null, error });
    await expect(submitProduction(kitchenRequest)).rejects.toBe(error);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(kitchenRequest).toEqual(savedRequest);
  });
});
