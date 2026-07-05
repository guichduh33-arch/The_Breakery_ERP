// apps/backoffice/src/features/orders/__tests__/void-idempotency-header.smoke.test.tsx
//
// Session 60 — Task 7 — BO smoke for the void flow `x-idempotency-key` wiring
// (POS S55 parity, fiche 02b D1.1).
//
// T1/T2: hook-level — useVoidOrder forwards idempotencyKey as the
//        `x-idempotency-key` header (or omits it) alongside the existing
//        `x-manager-pin` header; the JSON body stays `{ order_id, reason }`.
// T3:    modal-level — the modal's per-open UUID is stable across a failed
//        retry, and rotates both after a successful void AND when the modal
//        is closed (Cancel) without submitting.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const authGetSessionMock = vi.fn<() => Promise<{ data: { session: { access_token: string } | null } }>>();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: () => authGetSessionMock() },
  },
}));

const fetchMock = vi.fn();
Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

import { useVoidOrder } from '../hooks/useVoidOrder.js';
import { VoidOrderModal } from '../components/VoidOrderModal.js';

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authGetSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
});

afterEach(() => {
  cleanup();
});

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// =====================================================================
// T1/T2 — hook-level header + body shape
// =====================================================================

describe('S60 useVoidOrder — x-idempotency-key header wiring', () => {
  it('T1: sends x-idempotency-key + x-manager-pin headers; body is { order_id, reason } only', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ order_id: 'ord-1', refund_id: 'ref-1', total_refunded: 0 }),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useVoidOrder(), { wrapper: makeWrapper(qc) });

    const idempotencyKey = '11111111-2222-4333-8444-555555555555';
    await act(async () => {
      await result.current.mutateAsync({
        orderId: 'ord-1',
        reason: 'test reason long enough',
        managerPin: '123456',
        idempotencyKey,
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers).toEqual(
      expect.objectContaining({
        'x-manager-pin': '123456',
        'x-idempotency-key': idempotencyKey,
        Authorization: 'Bearer tok',
        'Content-Type': 'application/json',
      }),
    );

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ order_id: 'ord-1', reason: 'test reason long enough' });
  });

  it('T2: without an idempotencyKey, no x-idempotency-key header is sent', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ order_id: 'ord-2', refund_id: 'ref-2', total_refunded: 0 }),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useVoidOrder(), { wrapper: makeWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        orderId: 'ord-2',
        reason: 'another test reason here',
        managerPin: '654321',
      });
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('x-idempotency-key');
  });
});

// =====================================================================
// T3 — modal-level UUID lifecycle
// =====================================================================

function Harness({ orderId }: { orderId: string }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={qc}>
      <button type="button" data-testid="toggle" onClick={() => setOpen((o) => !o)}>
        toggle
      </button>
      <VoidOrderModal open={open} onClose={() => setOpen(false)} orderId={orderId} orderNumber="#1003" />
    </QueryClientProvider>
  );
}

function enterReason(): void {
  fireEvent.change(screen.getByTestId('void-reason'), { target: { value: 'customer cancelled order' } });
}

function enterPin(pin: string): void {
  fireEvent.change(screen.getByTestId('void-pin'), { target: { value: pin } });
}

// fireEvent already wraps dispatch in `act()` internally; the follow-up
// `waitFor` in each test flushes the mutation's own async work.
function clickSubmit(): void {
  fireEvent.click(screen.getByTestId('void-submit'));
}

function clickCancel(): void {
  fireEvent.click(screen.getByTestId('void-cancel'));
}

async function reopen(): Promise<void> {
  fireEvent.click(screen.getByTestId('toggle'));
  await waitFor(() => {
    expect(screen.queryByTestId('void-reason')).not.toBeNull();
  });
}

function failOnce(): void {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({ error: 'boom' }) });
}

function succeedOnce(orderId: string): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ order_id: orderId, refund_id: 'ref-x', total_refunded: 0 }),
  });
}

describe('S60 VoidOrderModal — idempotency key lifecycle', () => {
  it('T3a: the key is a UUID v4 and stays identical across a failed retry', async () => {
    render(<Harness orderId="ord-3a" />);
    enterReason();
    enterPin('111111');

    failOnce();
    clickSubmit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const key1 = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(key1['x-idempotency-key']).toMatch(UUID_V4_RE);

    failOnce();
    clickSubmit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const key2 = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(key2['x-idempotency-key']).toBe(key1['x-idempotency-key']);
  });

  it('T3b: the key rotates after a successful void', async () => {
    render(<Harness orderId="ord-3b" />);
    enterReason();
    enterPin('222222');

    succeedOnce('ord-3b');
    clickSubmit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const key1 = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;

    await reopen();
    enterReason();
    enterPin('333333');
    failOnce();
    clickSubmit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const key2 = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;

    expect(key2['x-idempotency-key']).toMatch(UUID_V4_RE);
    expect(key2['x-idempotency-key']).not.toBe(key1['x-idempotency-key']);
  });

  it('T3c: the key rotates when the modal is closed (Cancel) without submitting', async () => {
    render(<Harness orderId="ord-3c" />);
    enterReason();
    enterPin('444444');

    failOnce();
    clickSubmit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const key1 = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;

    clickCancel();
    await reopen();
    enterReason();
    enterPin('555555');
    succeedOnce('ord-3c');
    clickSubmit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const key2 = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;

    expect(key2['x-idempotency-key']).toMatch(UUID_V4_RE);
    expect(key2['x-idempotency-key']).not.toBe(key1['x-idempotency-key']);
  });
});
