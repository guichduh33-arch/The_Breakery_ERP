// apps/pos/src/features/shift/__tests__/CloseShiftModal.smoke.test.tsx
// Session 13 / Phase 3.C — RTL smoke for CloseShiftModal.
// LOT 4 (audit 2026-06-25) — blind cash count: expected & variance are hidden
// during entry and only revealed after the count is confirmed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CloseShiftModal, type CloseShiftModalProps } from '../components/CloseShiftModal';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

// S67 (12 D2.2/D2.3) — three-way count (QRIS/card volets) + opt-in
// denomination grid. Stable vi.hoisted refs (project memory: unstable mock
// data feeding renders can OOM-loop) so individual tests can override with
// mockReturnValueOnce without fighting module init order. Default enables
// ALL 4 non-blind-cash-adjacent methods so the "hides volet when disabled"
// test has something to disable.
const { mockDenomEnabled, mockEnabledMethods } = vi.hoisted(() => ({
  mockDenomEnabled: vi.fn(() => false),
  mockEnabledMethods: vi.fn(() => new Set(['cash', 'card', 'qris', 'edc'])),
}));
vi.mock('../hooks/useDenominationCountEnabled', () => ({
  useDenominationCountEnabled: () => mockDenomEnabled(),
}));
vi.mock('@/features/settings/hooks/useEnabledPaymentMethods', () => ({
  useEnabledPaymentMethods: () => mockEnabledMethods(),
}));

const rpcMock = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>();
const invokeMock = vi
  .fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>()
  .mockResolvedValue({ data: { signed_url: 'https://example.test/z' }, error: null });
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

const storeMock = { clear: vi.fn() };
vi.mock('@/stores/shiftStore', () => ({
  useShiftStore: <T,>(selector: (s: { clear: () => void }) => T) => selector(storeMock),
}));

const noop = () => undefined;

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

const DEFAULT_PROPS: CloseShiftModalProps = {
  open: true,
  sessionId: 's1',
  expectedCash: 500_000,
  thresholdAbs: 50_000,
  thresholdPct: 0.005,
  pinThresholdAbs: 10_000_000,
  pinThresholdPct: 0.5,
  onClose: noop,
};

/** S67 helper: render with sane defaults, override per test as needed. */
function renderModal(overrides: Partial<CloseShiftModalProps> = {}) {
  return render(withQuery(<CloseShiftModal {...DEFAULT_PROPS} {...overrides} />));
}

/**
 * Type the digits on the numpad then commit the blind count → review step.
 * S67: when the QRIS/card volets are visible (default mock enables all 4
 * methods) they are required-when-visible before Confirm count unlocks — fill
 * them with 0 so pre-S67 cash-only assertions in this file stay unaffected.
 */
function countAndConfirm(amount: string): void {
  for (const ch of amount) {
    fireEvent.click(screen.getByRole('button', { name: ch }));
  }
  const qris = screen.queryByTestId('counted-qris-input');
  if (qris) fireEvent.change(qris, { target: { value: '0' } });
  const card = screen.queryByTestId('counted-card-input');
  if (card) fireEvent.change(card, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: /confirm count/i }));
}

describe('CloseShiftModal', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    storeMock.clear.mockReset();
    mockDenomEnabled.mockReset().mockReturnValue(false);
    mockEnabledMethods.mockReset().mockReturnValue(new Set(['cash', 'card', 'qris', 'edc']));
  });

  it('hides expected cash and variance during the blind count (LOT 4)', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={500_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={noop}
      />,
    ));
    // Blind step: counted cash field shows, but NOT expected/variance.
    expect(screen.getByText(/counted cash/i)).toBeInTheDocument();
    expect(screen.queryByText(/expected cash/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('variance-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('variance-warning-badge')).not.toBeInTheDocument();
    // The expected figure (500.000) must not leak anywhere on screen.
    expect(screen.queryByText(/500\.000/)).not.toBeInTheDocument();
  });

  it('reveals expected cash and variance only after confirming the count', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={500_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={noop}
      />,
    ));
    countAndConfirm('500000');
    expect(screen.getByText(/expected cash/i)).toBeInTheDocument();
    expect(screen.getByTestId('variance-preview')).toBeInTheDocument();
    // Counted 500.000 vs expected 500.000 → variance 0.
    expect(screen.getByTestId('variance-preview').textContent).toMatch(/^0$/);
  });

  it('disables confirm until amount entered', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={noop}
      />,
    ));
    expect(screen.getByRole('button', { name: /confirm count/i })).toBeDisabled();
  });

  it('emits warning badge when variance breaches threshold (after reveal)', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={noop}
      />,
    ));
    countAndConfirm('0');
    expect(screen.getByTestId('variance-warning-badge')).toBeInTheDocument();
  });

  it('blocks closing on above-threshold variance without a note (P1-2)', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={570_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={vi.fn()}
      />,
    ));
    // Compte 500 000 → variance -70 000 > seuil abs 50 000.
    countAndConfirm('500000');
    expect(screen.getByRole('button', { name: /close shift/i })).toBeDisabled();
    expect(screen.getByText(/note .*(required|obligatoire)/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: 'till miscount, recount pending' },
    });
    expect(screen.getByRole('button', { name: /close shift/i })).toBeEnabled();
  });

  it('does not require a note when variance is within threshold', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={vi.fn()}
      />,
    ));
    // Compte 100 300 → variance +300 : sous le seuil abs (50 000) ET sous le
    // seuil pct (0,3 % < 0,5 %).
    countAndConfirm('100300');
    expect(screen.getByRole('button', { name: /close shift/i })).toBeEnabled();
    expect(screen.queryByText(/note .*(required|obligatoire)/i)).not.toBeInTheDocument();
  });

  it('Back returns to the blind count and re-hides expected/variance', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={vi.fn()}
      />,
    ));
    countAndConfirm('100000');
    expect(screen.getByText(/expected cash/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.queryByText(/expected cash/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('variance-preview')).not.toBeInTheDocument();
  });

  it('calls close_shift_v4 with parsed args and chains generate-zreport-pdf EF', async () => {
    // S66: the modal now also fetches list_login_users_v1 (approver picker) via
    // the same rpc mock — dispatch by function name so each caller gets a
    // correctly-shaped payload.
    rpcMock.mockImplementation((fn: unknown) =>
      fn === 'list_login_users_v1'
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({
            data: {
              session_id: 's1', status: 'closed', opening_cash: 100_000, cash_sales: 0,
              cash_in_total: 0, cash_out_total: 0, counted_cash: 105_000,
              expected_cash: 100_000, variance: 5_000, journal_entry_id: 'je-1',
              zreport_id: 'zr-1', variance_approved_by: null, idempotent_replay: false,
            },
            error: null,
          }),
    );
    invokeMock.mockClear();
    const onClose = vi.fn();
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={onClose}
      />,
    ));
    countAndConfirm('105000');
    // Variance +5 000 = 5 % > seuil pct 0,5 % → une note est requise (P1-2).
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: 'recount confirmed by manager' },
    });
    const btn = screen.getByRole('button', { name: /close shift/i });
    fireEvent.click(btn);
    // Flush microtasks: 1st for the RPC await, 2nd for the EF invoke chain, 3rd for the onSuccess.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // ADR-009 déc. 4 — close_shift bumped to v7 (paid|completed readers).
    expect(rpcMock).toHaveBeenCalledWith('close_shift_v8', expect.objectContaining({
      p_session_id: 's1',
      p_counted_cash: 105_000,
    }));
    expect(invokeMock).toHaveBeenCalledWith('generate-zreport-pdf', expect.objectContaining({
      body: { zreport_id: 'zr-1' },
      headers: expect.objectContaining({ 'x-idempotency-key': expect.any(String) as unknown }) as unknown,
    }));
  });

  it('does not throw when EF generate-zreport-pdf fails (non-blocking)', async () => {
    rpcMock.mockImplementation((fn: unknown) =>
      fn === 'list_login_users_v1'
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({
            data: {
              session_id: 's1', status: 'closed', opening_cash: 100_000, cash_sales: 0,
              cash_in_total: 0, cash_out_total: 0, counted_cash: 100_000,
              expected_cash: 100_000, variance: 0, journal_entry_id: 'je-2',
              zreport_id: 'zr-2', variance_approved_by: null, idempotent_replay: false,
            },
            error: null,
          }),
    );
    invokeMock.mockRejectedValueOnce(new Error('network failure'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onClose = vi.fn();
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={10_000_000}
        pinThresholdPct={0.5}
        onClose={onClose}
      />,
    ));
    countAndConfirm('100000');
    fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
    // Wait for the mutation chain to complete (RPC → EF.invoke → catch → return).
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled());
    // Shift still closed (RPC succeeded), EF failure was swallowed (no throw).
    expect(rpcMock).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // ── S66 (12 D2.1) — manager approval on large variances ────────────────────

  it('requires a designated manager + 6-digit PIN above the PIN threshold (S66)', async () => {
    rpcMock.mockImplementation((fn: unknown) =>
      fn === 'list_login_users_v1'
        ? Promise.resolve({
            data: [
              { id: 'mgr-1', display_name: 'Marie Manager', role: 'Manager' },
              { id: 'csh-1', display_name: 'Carl Cashier', role: 'Cashier' },
            ],
            error: null,
          })
        : Promise.resolve({ data: null, error: null }),
    );
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={570_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={200_000}
        pinThresholdPct={0.02}
        onClose={vi.fn()}
      />,
    ));
    // Compte 270 000 → variance -300 000 : au-dessus du seuil note (50k) ET du
    // seuil PIN (200k) → note + approbation manager exigées.
    countAndConfirm('270000');
    expect(await screen.findByTestId('manager-approval-section')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: 'large shortage — investigating' },
    });
    // Note posée mais pas d'approbateur/PIN → toujours bloqué.
    expect(screen.getByRole('button', { name: /close shift/i })).toBeDisabled();
    // Le picker ne liste que les rôles manager (le caissier est filtré).
    expect(screen.queryByText(/Carl Cashier/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/manager approval/i), { target: { value: 'mgr-1' } });
    fireEvent.change(screen.getByPlaceholderText(/manager pin/i), { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: /close shift/i })).toBeEnabled();
  });

  it('does not show the manager approval section below the PIN threshold', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={570_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        pinThresholdAbs={200_000}
        pinThresholdPct={0.9}
        onClose={vi.fn()}
      />,
    ));
    // Compte 500 000 → variance -70 000 : note requise (>50k) mais sous le
    // seuil PIN abs (200k) et pct (0.9) → pas de section manager.
    countAndConfirm('500000');
    expect(screen.queryByTestId('manager-approval-section')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: 'till miscount, recount pending' },
    });
    expect(screen.getByRole('button', { name: /close shift/i })).toBeEnabled();
  });

  // ── S67 (12 D2.2/D2.3) — three-way count (QRIS/card volets) + opt-in
  //    denomination grid ────────────────────────────────────────────────────

  it('shows QRIS and card count inputs on the count step (blind: no expected)', () => {
    renderModal();
    expect(screen.getByTestId('counted-qris-input')).toBeInTheDocument();
    expect(screen.getByTestId('counted-card-input')).toBeInTheDocument();
    // Deviation from the brief's literal /expected/i: the count-step helper
    // copy ("...stays hidden until you confirm...") legitimately contains the
    // word "expected" without leaking any figure. Assert the actual invariant
    // instead — no "Expected cash" row/label and no variance preview.
    expect(screen.queryByText(/expected cash/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('variance-preview')).not.toBeInTheDocument();
  });

  it('hides the QRIS volet when the method is disabled', () => {
    mockEnabledMethods.mockReturnValueOnce(new Set(['cash', 'card']));
    renderModal();
    expect(screen.queryByTestId('counted-qris-input')).not.toBeInTheDocument();
  });

  // Lot B (ADR-006 déc. 9) — the QRIS volet aggregates the e-wallets server-side
  // (close_shift_v8 bucket), so an e-wallet alone must surface the count field.
  it('shows the QRIS volet when only an e-wallet is enabled', () => {
    mockEnabledMethods.mockReturnValueOnce(new Set(['cash', 'gopay']));
    renderModal();
    expect(screen.getByTestId('counted-qris-input')).toBeInTheDocument();
  });

  it('replaces the numpad with the denomination grid when the flag is on', () => {
    mockDenomEnabled.mockReturnValueOnce(true);
    renderModal();
    expect(screen.getByTestId('denomination-grid')).toBeInTheDocument();
  });

  it('blocks Confirm count until visible non-cash volets are filled', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByRole('button', { name: /confirm count/i })).toBeDisabled();
    fireEvent.change(screen.getByTestId('counted-qris-input'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('counted-card-input'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /confirm count/i })).toBeEnabled();
  });
});
