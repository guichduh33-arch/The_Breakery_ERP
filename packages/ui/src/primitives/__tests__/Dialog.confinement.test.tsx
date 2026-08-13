// packages/ui/src/primitives/__tests__/Dialog.confinement.test.tsx
//
// Critique /impeccable 2026-08-13 (P1) — confinement des modales, vérifié
// puis GRAVÉ. Le constat live (« aria-modal absent, #root non caché ») était
// un artefact de mesure : Radix ne pose volontairement PAS aria-modal —
// commentaire source de @radix-ui/react-dialog : « aria-hide everything
// except the content (better supported equivalent to setting aria-modal) ».
// Le confinement réel passe par aria-hidden sur les frères du portail
// (hideOthers), dont dépend déjà DEV-S35-E3-01 (VirtualKeypadProvider).
//
// Ces tests gravent la garantie qui compte : pendant qu'un dialogue est
// ouvert, le reste de l'application est HORS de l'arbre d'accessibilité, et
// il y revient à la fermeture. Le primitif étant partagé, la garantie couvre
// toutes les modales du back-office et de la caisse (VoidOrderModal,
// AdjustModal, PinVerificationModal…).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../Dialog.js';

afterEach(cleanup);

function AppLike({ open }: { open: boolean }) {
  return (
    <>
      <main data-testid="behind">
        <button>action derrière la modale</button>
      </main>
      <Dialog open={open}>
        <DialogContent>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>Recorded as a permanent movement.</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('Dialog — confinement des technologies d’assistance', () => {
  it('retire le reste de l’application de l’arbre d’accessibilité pendant l’ouverture', async () => {
    render(<AppLike open />);
    // Le dialogue reste le seul contenu interrogeable par rôle…
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Adjust stock' })).toBeInTheDocument();
    // …pendant que l'arrière-plan est sorti de l'arbre (aria-hidden via
    // hideOthers — Testing Library ne « voit » plus le bouton derrière).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'action derrière la modale' })).toBeNull();
    });
  });

  it('rend le reste de l’application à l’arbre d’accessibilité à la fermeture', async () => {
    const { rerender } = render(<AppLike open />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'action derrière la modale' })).toBeNull();
    });
    rerender(<AppLike open={false} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'action derrière la modale' })).toBeInTheDocument();
    });
  });
});
