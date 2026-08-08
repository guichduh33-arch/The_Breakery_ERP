// apps/backoffice/src/components/__tests__/RouteErrorBoundary.test.tsx
//
// Audit /impeccable 2026-08-08 — la frontière d'erreur des pages.
//
// Une frontière qui ne rattrape rien est pire que pas de frontière : elle donne
// l'illusion du filet. Ces trois cas couvrent ce qu'on attend d'elle — attraper,
// laisser repartir, et ne pas garder l'écran de panne d'une page sur la
// suivante.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary.js';

/** Page qui tombe tant que `boom` est vrai. */
function Boom({ boom }: { boom: boolean }) {
  if (boom) throw new Error('render exploded');
  return <p>page rendered</p>;
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    // React journalise l'exception attaquée ; on tait le bruit sans masquer
    // un échec réel — le test assure sur le rendu, pas sur la console.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('rend un écran de panne au lieu de démonter l’arbre', () => {
    render(
      <MemoryRouter initialEntries={['/backoffice/reports']}>
        <RouteErrorBoundary><Boom boom /></RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('This page stopped working')).toBeInTheDocument();
    expect(screen.queryByText('page rendered')).not.toBeInTheDocument();
  });

  it('laisse repartir la page quand on réessaie', () => {
    // Le drapeau vit HORS du composant : React relance le rendu une fois après
    // avoir attrapé, si bien qu'un « ne tombe qu'au premier rendu » se répare
    // tout seul avant même que l'écran de panne s'affiche.
    const fault = { active: true };
    function Flaky() {
      if (fault.active) throw new Error('render exploded');
      return <p>page rendered</p>;
    }

    render(
      <MemoryRouter initialEntries={['/backoffice/reports']}>
        <RouteErrorBoundary><Flaky /></RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('This page stopped working')).toBeInTheDocument();

    fault.active = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('page rendered')).toBeInTheDocument();
    expect(screen.queryByText('This page stopped working')).not.toBeInTheDocument();
  });

  it('ne garde pas l’écran de panne d’une route sur la suivante', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/backoffice/reports']}>
        <RouteErrorBoundary><Boom boom /></RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('This page stopped working')).toBeInTheDocument();
    unmount();

    // Autre chemin : la clé de route remonte la frontière, l'état d'erreur
    // de la précédente ne survit pas.
    render(
      <MemoryRouter initialEntries={['/backoffice/products']}>
        <RouteErrorBoundary><Boom boom={false} /></RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('page rendered')).toBeInTheDocument();
    expect(screen.queryByText('This page stopped working')).not.toBeInTheDocument();
  });
});
