// apps/pos/src/features/lan/__tests__/QuarantineAlertBanner.test.tsx
//
// S3-17 — ADR-018 D5 : un règlement hors ligne mis en quarantaine lève une
// alerte caisse persistante (aucun bouton de fermeture, survit au remontage) ;
// une quarantaine sans règlement (fire seul) ou un registre vide n'en lève pas.

/// <reference types="@testing-library/jest-dom" />
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { QuarantineAlertBanner } from '../QuarantineAlertBanner';
import { quarantineIntents, type OfflineIntent } from '../offlineOutbox';

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: qc }, createElement(QuarantineAlertBanner)));
}

const paymentIntent = {
  kind: 'payment', id: 'pay-1', seq: 2, created_at: '2026-11-18T10:00:00.000Z',
  root_client_uuid: 'root-1', local_number: 'L-0007',
  payments: [{ method: 'cash', amount: 50_000 }],
} as unknown as OfflineIntent;

const legacyCashIntent = {
  kind: 'cash_payment', id: 'cash-1', seq: 3, created_at: '2026-11-18T10:05:00.000Z',
  root_client_uuid: 'root-2', local_number: 'L-0008',
  payment: { method: 'cash', amount: 20_000, cash_received: 20_000, change_given: 0 },
} as OfflineIntent;

const fireIntent = {
  kind: 'fire', id: 'fire-1', seq: 1, created_at: '2026-11-18T09:55:00.000Z',
  root_client_uuid: 'fire-1', local_number: 'L-0006', session_id: 's-1',
  order_type: 'take_away', table_number: null, items: [],
} as OfflineIntent;

beforeEach(() => {
  localStorage.clear();
});

describe('QuarantineAlertBanner', () => {
  it('is absent when the quarantine registry is empty', async () => {
    renderBanner();
    // Laisse la requête se résoudre avant de conclure à l'absence.
    await waitFor(() => expect(screen.queryByTestId('offline-quarantine-alert')).toBeNull());
  });

  it('is absent when only a fire (non-payment) intent is quarantined', async () => {
    await quarantineIntents([{ intent: fireIntent, code: 'P0011', reason: 'table_required_for_dine_in' }]);
    renderBanner();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('offline-quarantine-alert')).toBeNull();
  });

  it('shows a persistent alert with local number and reason, without close button, and survives remount', async () => {
    await quarantineIntents([
      { intent: paymentIntent, code: 'P0001', reason: 'order_already_paid' },
      { intent: legacyCashIntent, code: null, reason: 'cascade' },
      { intent: fireIntent, code: 'P0011', reason: 'table_required_for_dine_in' },
    ]);
    const first = renderBanner();
    const alert = await screen.findByTestId('offline-quarantine-alert');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('2 offline payments were rejected by the server and must be settled with a manager');
    const items = within(alert).getAllByTestId('offline-quarantine-item');
    expect(items).toHaveLength(2);
    expect(alert).toHaveTextContent('L-0007');
    expect(alert).toHaveTextContent('order_already_paid (P0001)');
    expect(alert).toHaveTextContent('L-0008');
    expect(alert).not.toHaveTextContent('L-0006');
    expect(within(alert).queryByRole('button')).toBeNull();

    first.unmount();
    renderBanner();
    expect(await screen.findByTestId('offline-quarantine-alert')).toBeInTheDocument();
  });

  it('uses the singular wording for one payment', async () => {
    await quarantineIntents([{ intent: paymentIntent, code: 'P0001', reason: 'order_already_paid' }]);
    renderBanner();
    expect(await screen.findByTestId('offline-quarantine-alert'))
      .toHaveTextContent('1 offline payment was rejected by the server and must be settled with a manager');
  });
});
