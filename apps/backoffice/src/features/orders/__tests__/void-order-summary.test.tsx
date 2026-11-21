// apps/backoffice/src/features/orders/__tests__/void-order-summary.test.tsx
//
// Audit Sales 2026-11-21 : la fenêtre de void ne nommait que le stock. Elle
// dit désormais le montant et le moyen de paiement AVANT le PIN, et annonce la
// règle des espèces au lieu de la faire tomber après la saisie.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
  },
}));

import { VoidOrderModal } from '../components/VoidOrderModal.js';

function renderModal(extra: { total?: number; paymentMethod?: string | null }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoidOrderModal open onClose={() => undefined} orderId="ord-1" orderNumber="#0005" {...extra} />
    </QueryClientProvider>,
  );
}

describe('VoidOrderModal — money summary', () => {
  it('shows the order total and how it was paid before the PIN', () => {
    renderModal({ total: 166_000, paymentMethod: 'qris' });
    const summary = screen.getByTestId('void-summary');
    expect(summary).toHaveTextContent('Order total');
    expect(summary).toHaveTextContent('Rp 166.000');
    expect(summary).toHaveTextContent('Paid by');
    expect(summary).toHaveTextContent('QRIS');
    expect(screen.queryByText(/only be voided while its POS session is open/i)).not.toBeInTheDocument();
  });

  it('warns up front that a cash void needs an open POS session', () => {
    renderModal({ total: 30_000, paymentMethod: 'cash' });
    expect(screen.getByText(/only be voided while its POS session is open/i)).toBeInTheDocument();
  });

  it('renders no summary when the caller has no amount', () => {
    renderModal({});
    expect(screen.queryByTestId('void-summary')).not.toBeInTheDocument();
  });
});
