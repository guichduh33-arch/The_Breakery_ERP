// apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx
//
// Session 25 — Phase 2.A.4 — POS smoke for the post-S25 refund flow wiring.
//
// Verifies two things the modal/hook contract now guarantees:
//
//   C1. useRefundOrder pushes the manager PIN into the `x-manager-pin` HTTP
//       header (NOT the JSON body) and forwards the modal's idempotency key
//       as `x-idempotency-key`. Body must NOT carry `manager_pin`.
//
//   C2. RefundOrderModal.idempotencyKeyRef sticks across a failed-then-retried
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

// Minimal OrderDetail shape required by RefundOrderModal.
function buildOrder() {
  return {
    id: 'order-1',
    order_number: '#1001',
    status: 'paid' as const,
    total: 50_000,
    tax_amount: 4_545,
    customer_id: null,
    table_number: null,
    paid_at: '2026-05-19T00:00:00.000Z',
    voided_at: null,
    void_reason: null,
    items: [
      {
        id: 'oi-1',
        product_id: 'p-1',
        name_snapshot: 'Americano',
        quantity: 1,
        line_total: 50_000,
        is_cancelled: false,
        qty_already_refunded: 0,
      },
    ],
    payments: [
      { id: 'pay-1', method: 'cash' as const, amount: 50_000, reference: null },
    ],
    refunded_by_method: {},
    total_refunded: 0,
  };
}

// Drive the RefundOrderModal through line pick → tender amount → reason → PIN → submit.
async function driveModalToSubmit(pin = '123456'): Promise<void> {
  // 1. Select the (single) line — checkbox aria-label = "Refund line Americano"
  fireEvent.click(screen.getByLabelText(/Refund line Americano/i));

  // 2. Fill tender amount — input aria-label = "Refund amount for cash"
  fireEvent.change(screen.getByLabelText(/Refund amount for cash/i), {
    target: { value: '50000' },
  });

  // 3. Reason ≥3 chars
  fireEvent.change(screen.getByPlaceholderText(/spilled latte/i), {
    target: { value: 'customer return' },
  });

  // 4. PIN — Numpad buttons are aria-label=<digit>. Find them inside the
  // Numpad group to avoid clashing with stepper "+1"/"-1" buttons.
  const numpad = screen.getByRole('group', { name: /Numpad/i });
  for (const digit of pin) {
    fireEvent.click(within(numpad).getByRole('button', { name: digit }));
  }

  // 5. Verify
  fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));
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

describe('S25 useRefundOrder — manager-pin header + idempotency wiring', () => {
  it('C1: sends x-manager-pin + x-idempotency-key headers; body has no manager_pin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          refund_id: 'rf-1',
          refund_number: 'RF-001',
          order_id: 'order-1',
          order_number: '#1001',
          total_refunded: 50_000,
          tax_refunded: 4_545,
          tenders: [{ method: 'cash', amount: 50_000 }],
          pts_deducted: 0,
          manager: { id: 'm1', full_name: 'Manager', role_code: 'MANAGER' },
        }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { useRefundOrder } = await import('../hooks/useRefundOrder');
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => useRefundOrder(), { wrapper: Wrapper });

    const idempotencyKey = '11111111-2222-4333-8444-555555555555';
    await act(async () => {
      await result.current.mutateAsync({
        orderId: 'order-1',
        lines: [{ order_item_id: 'oi-1', qty: 1 }],
        tenders: [{ method: 'cash', amount: 50_000 }],
        reason: 'customer return',
        managerPin: '987654',
        idempotencyKey,
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/refund-order');

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
    expect(body).toEqual({
      order_id: 'order-1',
      lines: [{ order_item_id: 'oi-1', qty: 1 }],
      tenders: [{ method: 'cash', amount: 50_000 }],
      reason: 'customer return',
    });
    expect(body).not.toHaveProperty('manager_pin');
    expect(body).not.toHaveProperty('managerPin');
  });
});

// =====================================================================
// C2 — Modal-level: UUID lifecycle (sticky on retry, fresh on reopen).
// We capture the idempotencyKey from the onSubmit args; no fetch needed.
// =====================================================================

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('S25 RefundOrderModal — idempotency UUID lifecycle', () => {
  it('C2: retry reuses UUID; close+reopen rotates UUID; both are UUID v4', async () => {
    const { RefundOrderModal } = await import('../components/RefundOrderModal');

    type SubmitArgs = Parameters<
      React.ComponentProps<typeof RefundOrderModal>['onSubmit']
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
          <RefundOrderModal
            open={open}
            onClose={() => setOpen(false)}
            order={buildOrder()}
            onSubmit={onSubmit}
            isPending={false}
          />
        </>
      );
    }

    const Wrapper = makeWrapper();
    render(<Wrapper><Harness /></Wrapper>);

    // Radix Dialog mounts via Portal — wait for our checkbox to land in the DOM.
    await waitFor(() => {
      expect(screen.queryByLabelText(/Refund line Americano/i)).not.toBeNull();
    });

    // --- 1st submit (will fail) ---
    await driveModalToSubmit('111111');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const firstUuid = captured[0]!.idempotencyKey;
    expect(firstUuid).toMatch(UUID_V4_RE);

    // The failure caused modal to bump pinKey (remounting NumpadPin) but the
    // line/tender/reason state is preserved. Re-enter the PIN and resubmit.
    // Only the PIN needs re-entry; lines/tender/reason persist.
    const numpad1 = screen.getByRole('group', { name: /Numpad/i });
    for (const digit of '222222') {
      fireEvent.click(within(numpad1).getByRole('button', { name: digit }));
    }
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const retryUuid = captured[1]!.idempotencyKey;
    expect(retryUuid).toBe(firstUuid); // sticky across retry

    // --- Close + reopen via toggle (handleClose swaps the ref) ---
    // Click the X "Close" button (which calls handleClose → rotates UUID).
    // Note: the modal has multiple "Cancel" buttons (NumpadPin's reset + footer's),
    // so target the unambiguous Close icon via its aria-label.
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));

    // Wait for the dialog to be removed from the document.
    await waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    // After close, reopen via the harness toggle.
    fireEvent.click(screen.getByTestId('toggle'));

    // Wait for the dialog to remount (Radix Portal mounts async via useEffect).
    await waitFor(() => {
      expect(screen.queryByLabelText(/Refund line Americano/i)).not.toBeNull();
    });

    // Modal is open again, but all state (lines/tender/reason) was wiped.
    // Drive the flow afresh; this time let the submit succeed.
    shouldFail = false;
    await driveModalToSubmit('333333');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    const reopenUuid = captured[2]!.idempotencyKey;
    expect(reopenUuid).toMatch(UUID_V4_RE);
    expect(reopenUuid).not.toBe(firstUuid); // rotated on close+reopen
  });
});
