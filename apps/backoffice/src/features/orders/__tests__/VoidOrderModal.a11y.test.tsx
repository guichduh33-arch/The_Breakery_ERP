// apps/backoffice/src/features/orders/__tests__/VoidOrderModal.a11y.test.tsx
//
// Critique /impeccable 2026-08-13 (P1) — la modale la plus dangereuse du
// produit avait deux champs sans étiquette programmatique : un lecteur d'écran
// entendait « edit text » deux fois sans savoir laquelle était le PIN. Ces
// tests gravent le rattachement label→champ et erreur→champ.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
  },
}));

import { VoidOrderModal } from '../components/VoidOrderModal.js';

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoidOrderModal open onClose={() => undefined} orderId="ord-1" orderNumber="#0005" />
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('VoidOrderModal — étiquetage programmatique', () => {
  it('expose Reason et Manager PIN par leur étiquette', () => {
    renderModal();
    expect(screen.getByLabelText('Reason for voiding')).toBe(screen.getByTestId('void-reason'));
    expect(screen.getByLabelText('Manager PIN')).toBe(screen.getByTestId('void-pin'));
  });

  it('rattache l’erreur de motif au champ (aria-invalid + aria-describedby)', () => {
    renderModal();
    const reason = screen.getByLabelText('Reason for voiding');
    expect(reason).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(reason, { target: { value: 'trop court' } });
    expect(reason).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(reason, { target: { value: 'court' } });
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    const errorId = reason.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent('Min. 10 characters');
  });
});
