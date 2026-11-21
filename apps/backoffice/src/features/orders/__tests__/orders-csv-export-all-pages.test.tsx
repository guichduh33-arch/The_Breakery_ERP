// L'export CSV des commandes couvrait les seules pages chargées (50 lignes) :
// il doit charger toute la fenêtre serveur, puis suivre la recherche locale.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import type { OrdersListLine, OrdersListPage } from '../hooks/useOrdersList.js';
import {
  loadAllOrderPages,
  matchesQuickFind,
  useOrdersCsvExport,
  type ExportableOrdersQuery,
} from '../hooks/useOrdersCsvExport.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function line(n: number, customer: string | null = null): OrdersListLine {
  return {
    id: `o-${n}`, order_number: `ORD-${String(n).padStart(3, '0')}`, order_type: 'dine_in', status: 'paid',
    total: 10_000, created_at: '2026-11-21T01:00:00Z', paid_at: null, table_number: null,
    customer_id: null, customer_name: customer, customer_type: null, served_by: null, served_by_name: null,
    terminal_id: null, refund_status: 'none', has_modifiers: false, payment_method_primary: 'cash', items_count: 1,
  };
}
const page = (lines: OrdersListLine[], last: boolean): OrdersListPage => ({
  lines, next_cursor_val: last ? null : 'c', next_cursor_id: last ? null : 'id', sort: 'created_at', dir: 'desc',
});

/** Query infinie simulée : `pages` restantes servies une à une. */
function fakeQuery(first: OrdersListPage[], rest: OrdersListPage[]): ExportableOrdersQuery & { fetchNextPage: ReturnType<typeof vi.fn> } {
  let pages = [...first];
  const queue = [...rest];
  const fetchNextPage = vi.fn(() => {
    const next = queue.shift();
    if (next) pages = [...pages, next];
    return Promise.resolve({ data: { pages }, hasNextPage: queue.length > 0, isError: false, error: null });
  });
  return { data: { pages }, hasNextPage: rest.length > 0, fetchNextPage };
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

describe('loadAllOrderPages', () => {
  it('loads every remaining page of the same server filter', async () => {
    const q = fakeQuery([page([line(1), line(2)], false)], [page([line(3)], false), page([line(4)], true)]);
    const all = await loadAllOrderPages(q);
    expect(all.map((l) => l.id)).toEqual(['o-1', 'o-2', 'o-3', 'o-4']);
    expect(q.fetchNextPage).toHaveBeenCalledTimes(2);
    expect(q.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false });
  });

  it('refuses a truncated file when the cursor stops advancing or a page fails', async () => {
    const stuck: ExportableOrdersQuery = {
      data: { pages: [page([line(1)], false)] }, hasNextPage: true,
      fetchNextPage: () => Promise.resolve({ data: { pages: [page([line(1)], false)] }, hasNextPage: true }),
    };
    await expect(loadAllOrderPages(stuck)).rejects.toThrow(/could not be fully loaded/);
    const failing: ExportableOrdersQuery = {
      data: { pages: [page([line(1)], false)] }, hasNextPage: true,
      fetchNextPage: () => Promise.resolve({ hasNextPage: false, isError: true, error: new Error('timeout') }),
    };
    await expect(loadAllOrderPages(failing)).rejects.toThrow('timeout');
  });
});

describe('useOrdersCsvExport', () => {
  it('exports the whole window and says how many orders were written', async () => {
    const write = vi.fn();
    const q = fakeQuery([page([line(1), line(2)], false)], [page([line(3)], true)]);
    const { result } = renderHook(() => useOrdersCsvExport(q, write));
    await act(async () => { await result.current.run(''); });
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![0]).toHaveLength(3);
    expect(toast.success).toHaveBeenCalledWith('Exported 3 orders');
    expect(result.current.exporting).toBe(false);
  });

  it('follows the on-screen text search over the full window, and says so', async () => {
    const write = vi.fn();
    const q = fakeQuery([page([line(1, 'Café Bali')], false)], [page([line(2, 'Other'), line(3, 'café bali')], true)]);
    const { result } = renderHook(() => useOrdersCsvExport(q, write));
    await act(async () => { await result.current.run('Café Bali'); });
    expect((write.mock.calls[0]![0] as OrdersListLine[]).map((l) => l.id)).toEqual(['o-1', 'o-3']);
    expect(toast.success).toHaveBeenCalledWith('Exported 2 orders matching “Café Bali” (of 3 in the window)');
  });

  it('writes nothing and reports the failure when loading fails', async () => {
    const write = vi.fn();
    const q: ExportableOrdersQuery = {
      data: { pages: [page([line(1)], false)] }, hasNextPage: true,
      fetchNextPage: () => Promise.resolve({ hasNextPage: false, isError: true, error: new Error('timeout') }),
    };
    const { result } = renderHook(() => useOrdersCsvExport(q, write));
    await act(async () => { await result.current.run(''); });
    expect(write).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Export failed: timeout');
  });
});

describe('matchesQuickFind', () => {
  it('matches order number or customer, case-insensitively', () => {
    expect(matchesQuickFind(line(12, 'Warung'), 'ord-012')).toBe(true);
    expect(matchesQuickFind(line(12, 'Warung'), 'WAR')).toBe(true);
    expect(matchesQuickFind(line(12, null), 'war')).toBe(false);
    expect(matchesQuickFind(line(12, null), '  ')).toBe(true);
  });
});
