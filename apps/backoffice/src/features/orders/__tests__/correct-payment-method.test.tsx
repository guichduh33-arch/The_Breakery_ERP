// ADR-046 — fenêtre de correction du moyen de paiement : contrat d'appel de la
// RPC (PIN en argument, clé stable par ouverture), lecture des réponses et
// traduction des refus serveur.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: mocks.rpc } }));

import { CorrectPaymentMethodDialog, CORRECTABLE_METHODS } from '../components/CorrectPaymentMethodDialog.js';

const PAYMENT = { id: 'pay-1', method: 'cash', amount: 50_000 };

function mount(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CorrectPaymentMethodDialog open onClose={onClose} orderId="order-1" orderNumber="#ORD-1" payment={PAYMENT} />
    </QueryClientProvider>,
  );
  return onClose;
}

function fill(method = 'qris', reason = 'Customer paid by QRIS', pin = '246810') {
  fireEvent.change(screen.getByTestId('correct-method-select'), { target: { value: method } });
  fireEvent.change(screen.getByTestId('correct-method-reason'), { target: { value: reason } });
  fireEvent.change(screen.getByTestId('correct-method-pin'), { target: { value: pin } });
}

const OK = { ok: true, correction_id: 'corr-1', payment_id: 'pay-1', new_method: 'qris', journal_entry_id: 'je-1', session_closed: false };

beforeEach(() => { vi.clearAllMocks(); });

describe('CorrectPaymentMethodDialog', () => {
  it('never offers store credit nor the method already recorded', () => {
    mount();
    const values = [...screen.getByTestId<HTMLSelectElement>('correct-method-select').options].map((o) => o.value);
    expect(values).not.toContain('store_credit');
    expect(values).not.toContain('cash');
    expect(values).toContain('qris');
    expect(CORRECTABLE_METHODS).not.toContain('store_credit');
  });

  it('keeps the submit disabled until method, reason and a 6-digit PIN are set', () => {
    mount();
    const submit = screen.getByTestId('correct-method-submit');
    expect(submit).toBeDisabled();
    fill('qris', 'ok', '246810');
    expect(submit).toBeDisabled();
    fill('qris', 'Customer paid by QRIS', '2468');
    expect(submit).toBeDisabled();
    fill();
    expect(submit).toBeEnabled();
  });

  it('sends the PIN as an RPC argument and closes on a confirmed correction', async () => {
    mocks.rpc.mockResolvedValue({ data: OK, error: null });
    const onClose = mount();
    fill();
    fireEvent.click(screen.getByTestId('correct-method-submit'));
    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
    expect(mocks.rpc).toHaveBeenCalledWith('correct_order_payment_method_v1', expect.objectContaining({
      p_payment_id: 'pay-1', p_new_method: 'qris', p_reason: 'Customer paid by QRIS', p_manager_pin: '246810',
    }));
    const key = (mocks.rpc.mock.calls[0]![1] as { p_idempotency_key: string }).p_idempotency_key;
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('shows a wrong PIN returned by the server and keeps the same request key for the retry', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, error: 'invalid_pin' }, error: null });
    const onClose = mount();
    fill();
    fireEvent.click(screen.getByTestId('correct-method-submit'));
    expect(await screen.findByTestId('correct-method-error')).toHaveTextContent('Wrong PIN. Try again.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId<HTMLInputElement>('correct-method-pin').value).toBe('');
    mocks.rpc.mockResolvedValueOnce({ data: OK, error: null });
    fireEvent.change(screen.getByTestId('correct-method-pin'), { target: { value: '246810' } });
    fireEvent.click(screen.getByTestId('correct-method-submit'));
    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
    const keys = mocks.rpc.mock.calls.map((call) => (call[1] as { p_idempotency_key: string }).p_idempotency_key);
    expect(keys[0]).toBe(keys[1]);
  });

  it.each([
    ['payment_already_reconciled', 'already matched in a bank reconciliation'],
    ['imported_sale_not_correctable', 'imported from the previous POS'],
    ['super_admin_only', 'Only the super admin'],
    ['period_locked', 'accounting period of this sale is closed'],
  ])('translates the server refusal %s', async (code, text) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: code } });
    mount();
    fill();
    fireEvent.click(screen.getByTestId('correct-method-submit'));
    expect(await screen.findByTestId('correct-method-error')).toHaveTextContent(text);
  });

  it('does not claim success when the server confirms another payment', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...OK, payment_id: 'pay-other' }, error: null });
    const onClose = mount();
    fill();
    fireEvent.click(screen.getByTestId('correct-method-submit'));
    expect(await screen.findByTestId('correct-method-error')).toHaveTextContent('not confirmed');
    expect(onClose).not.toHaveBeenCalled();
  });
});
