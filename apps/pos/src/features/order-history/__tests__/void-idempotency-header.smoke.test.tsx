// apps/pos/src/features/order-history/__tests__/void-idempotency-header.smoke.test.tsx
//
// Session 55 — T7 — POS smoke for the void flow x-idempotency-key wiring.
//
// Mirrors the S25 refund smoke (refund-modal-pin-header.smoke.test.tsx). Verifies
// two things the modal/hook contract now guarantees:
//
//   C1. useVoidOrder pushes the manager PIN into the `x-manager-pin` HTTP header
//       (NOT the JSON body) and forwards the modal's idempotency key as
//       `x-idempotency-key` (valid UUID v4). Body must NOT carry manager_pin.
//
//   C2. VoidOrderModal.idempotencyKeyRef sticks across a failed-then-retried
//       submit (same UUID emitted twice) but is rotated on close+reopen
//       (different UUID on the next open session).
//
// All HTTP is mocked. No EF, no Supabase, no real PIN verification.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

// ---- Module mocks (must be declared before the dynamic imports below) ----

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'tok' } },
      }),
    },
  },
  supabaseUrl: 'http://localhost:54321',
}));

// ---- Shared helpers ----

const originalFetch = global.fetch;

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

// Enter reason (≥3 chars) + PIN digits. Digit clicks are intentionally NOT
// wrapped in a single act() — that would batch them so only one digit lands.
// fireEvent auto-wraps each individual event in act.
function enterReason(): void {
  fireEvent.change(screen.getByPlaceholderText(/wrong order/i), {
    target: { value: 'customer cancelled' },
  });
}

function enterPin(pin: string): void {
  const numpad = screen.getByRole('group', { name: /Numpad/i });
  for (const digit of pin) {
    fireEvent.click(within(numpad).getByRole('button', { name: digit }));
  }
}

// Click Verify inside an async act() so the fire-and-forget `void
// handlePinSubmit(pin)` promise (and its follow-up setState / handleClose)
// drains INSIDE the act boundary. Without this the drain tail spills into
// act cleanup and can time the test out (the DEV-RT-W3-01 flake).
async function clickVerify(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
  cleanup();
});

// =====================================================================
// C1 — Hook-level: header presence + body shape (manager_pin must NOT
// appear in the JSON body).
// =====================================================================

describe('S55 useVoidOrder — manager-pin header + idempotency wiring', () => {
  it('C1: sends x-manager-pin + x-idempotency-key headers; body has no manager_pin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          order_id: 'order-1',
          order_number: '#1001',
          refund_id: 'rf-1',
          refund_number: 'RF-001',
          total_refunded: 50_000,
          tax_refunded: 4_545,
          tenders: [{ method: 'cash', amount: 50_000 }],
          manager: { id: 'm1', full_name: 'Manager', role_code: 'MANAGER' },
        }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { useVoidOrder } = await import('../hooks/useVoidOrder');
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => useVoidOrder(), { wrapper: Wrapper });

    const idempotencyKey = '11111111-2222-4333-8444-555555555555';
    await act(async () => {
      await result.current.mutateAsync({
        orderId: 'order-1',
        reason: 'customer cancelled',
        managerPin: '987654',
        idempotencyKey,
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/void-order');

    // Headers
    const headers = init.headers as Record<string, string>;
    expect(headers).toEqual(
      expect.objectContaining({
        'x-manager-pin': '987654',
        'x-idempotency-key': idempotencyKey,
        Authorization: 'Bearer tok',
        'Content-Type': 'application/json',
      }),
    );

    // Body MUST NOT carry manager_pin
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ order_id: 'order-1', reason: 'customer cancelled' });
    expect(body).not.toHaveProperty('manager_pin');
    expect(body).not.toHaveProperty('managerPin');
    expect(body).not.toHaveProperty('idempotency_key');
  });
});

// =====================================================================
// C2 — Modal-level: UUID lifecycle (sticky on retry, fresh on reopen).
// We capture the idempotencyKey from the onSubmit args; no fetch needed.
// =====================================================================

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('S55 VoidOrderModal — idempotency UUID lifecycle', () => {
  it('C2: retry reuses UUID; close+reopen rotates UUID; both are UUID v4', async () => {
    const { VoidOrderModal } = await import('../components/VoidOrderModal');

    type SubmitArgs = Parameters<
      React.ComponentProps<typeof VoidOrderModal>['onSubmit']
    >[0];
    const captured: SubmitArgs[] = [];
    let shouldFail = true;
    const onSubmit = vi.fn(async (args: SubmitArgs) => {
      captured.push(args);
      if (shouldFail) throw new Error('simulated_failure');
    });

    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" data-testid="toggle" onClick={() => setOpen((o) => !o)}>
            toggle
          </button>
          <VoidOrderModal
            open={open}
            onClose={() => setOpen(false)}
            orderNumber="#1001"
            total={50_000}
            onSubmit={onSubmit}
            isPending={false}
          />
        </>
      );
    }

    const Wrapper = makeWrapper();
    render(<Wrapper><Harness /></Wrapper>);

    // FullScreenModal mounts via Portal — wait for the reason input to land.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/wrong order/i)).not.toBeNull();
    });

    // --- 1st submit (will fail) ---
    enterReason();
    enterPin('111111');
    await clickVerify();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const firstUuid = captured[0]!.idempotencyKey;
    expect(firstUuid).toMatch(UUID_V4_RE);

    // Failure bumped pinKey (remounting NumpadPin) but reason state persists.
    // Re-enter the PIN and resubmit — same modal instance → same key.
    enterPin('222222');
    await clickVerify();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const retryUuid = captured[1]!.idempotencyKey;
    expect(retryUuid).toBe(firstUuid); // sticky across retry

    // --- Close + reopen (handleClose rotates the ref) ---
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
    });
    await waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/wrong order/i)).not.toBeNull();
    });

    // Reopened; state wiped. Drive afresh, this time let submit succeed.
    shouldFail = false;
    enterReason();
    enterPin('333333');
    await clickVerify();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    const reopenUuid = captured[2]!.idempotencyKey;
    expect(reopenUuid).toMatch(UUID_V4_RE);
    expect(reopenUuid).not.toBe(firstUuid); // rotated on close+reopen
  });
});
