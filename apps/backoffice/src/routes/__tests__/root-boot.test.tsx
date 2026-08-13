// apps/backoffice/src/routes/__tests__/root-boot.test.tsx
//
// Critique /impeccable 2026-08-13 — le P0 du premier chargement.
//
// L'origine nue `/` tombait sur le catch-all racine, dont la page 404 est
// lazy et vivait HORS de toute frontière <Suspense> (la seule frontière est
// dans BackofficeLayout, donc à l'intérieur de /backoffice). Premier rendu à
// cache froid : « A component suspended while responding to synchronous
// input », #root vidé, écran blanc muet.
//
// Ces tests rendent le VRAI <App/> (pas un mini-routeur miroir) : ils
// garantissent à la fois la redirection `/` → /backoffice → /login et la
// présence d'une frontière Suspense au-dessus des routes hors coquille.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Store d'auth : session non authentifiée, réhydratation déjà terminée — on
// teste le routage, pas le boot réseau.
vi.mock('@/stores/authStore.js', () => {
  const state = {
    isAuthenticated: false,
    bootstrapStatus: 'ready',
    sessionTimeoutMinutes: 0,
    bootstrap: vi.fn(),
    logout: vi.fn(),
  };
  return { useAuthStore: (selector: (s: typeof state) => unknown) => selector(state) };
});

// La vraie page de login monte le picker d'utilisateurs (RPC réseau) — hors
// sujet ici, un témoin suffit.
vi.mock('@/pages/Login.js', () => ({
  default: () => <p>login page stub</p>,
}));

import App from '@/App.js';

describe('root boot', () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
  });

  it("redirige l'origine nue vers /backoffice puis /login quand non authentifié", async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(await screen.findByText('login page stub')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('rend la 404 lazy sous la frontière Suspense au lieu de démonter l’arbre', async () => {
    window.history.pushState({}, '', '/no-such-page');
    render(<App />);
    // Sans <Suspense> au-dessus d'<AppRoutes/>, ce rendu jette
    // « component suspended while responding to synchronous input ».
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});
