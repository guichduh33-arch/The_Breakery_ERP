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

import { VoidOrderModal, voidErrorText } from '../components/VoidOrderModal.js';

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

// Critique du 2026-08-26 — le chemin d'erreur rendait `m.error.message` brut
// dans un `role="alert"`. `useVoidOrder` y met TOUJOURS un jeton machine
// (`err.error ?? 'void_failed'`), donc la région live épelait
// « cross_shift_not_allowed » à qui n'y voit pas.
describe('voidErrorText — aucun jeton machine ne sort à l’écran', () => {
  it('traduit les jetons connus de l’EF', () => {
    expect(voidErrorText(new Error('wrong_pin'))).toBe('Invalid manager PIN.');
    expect(voidErrorText(new Error('cross_shift_not_allowed')))
      .toBe('This order belongs to a closed shift and can no longer be voided.');
    expect(voidErrorText(new Error('missing_manager_pin'))).toBe('Manager PIN is required.');
  });

  it('tait un jeton INCONNU au lieu de l’afficher', () => {
    // La doctrine `errorDetailText` : ce qui ressemble à du snake_case ou à un
    // code Postgres n'apprend rien au lecteur et ne sort pas.
    expect(voidErrorText(new Error('order_not_voidable'))).toBe('Something went wrong. Please retry.');
    expect(voidErrorText(new Error('P0001'))).toBe('Something went wrong. Please retry.');
    expect(voidErrorText({ nothing: true })).toBe('Something went wrong. Please retry.');
    expect(voidErrorText(new Error('[object Object]'))).toBe('Something went wrong. Please retry.');
  });

  it('laisse passer un message serveur écrit en clair', () => {
    expect(voidErrorText(new Error('The shift was closed at 21:04.')))
      .toBe('The shift was closed at 21:04.');
  });
});
