// apps/backoffice/src/layouts/BackofficeLayout.tsx
//
// Refonte shell 2026-08-05 — le shell global du Backoffice.
//
// Le rail rétractable de 240 px a disparu : la navigation est entièrement
// portée par la `TopBar` (52 px, 7 domaines, drop-panels) et par la palette de
// commandes ⌘K. Le contenu occupe donc toute la largeur, ce qui est le point
// de départ du dashboard 1c — dessiné sur un cadre de 1440 px sans rail.
//
// Les clés localStorage `bo:sidebar:collapsed` / `:groups` / `:subgroups` sont
// devenues sans objet ; on les purge une fois au montage pour ne pas laisser
// traîner de l'état mort dans le navigateur des postes existants.

import { Suspense, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { CommandPalette } from './CommandPalette.js';
import { TopBar } from './TopBar.js';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary.js';

const DEAD_SIDEBAR_KEYS = [
  'bo:sidebar:collapsed',
  'bo:sidebar:groups',
  'bo:sidebar:subgroups',
];

/** Shown while a route-split page chunk is being fetched (React.lazy). */
function RouteFallback() {
  return (
    <div
      className="grid h-full place-items-center text-text-secondary"
      aria-busy="true"
      aria-live="polite"
    >
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-border-subtle border-t-gold"
        aria-hidden
      />
    </div>
  );
}

export function BackofficeLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try {
      for (const key of DEAD_SIDEBAR_KEYS) localStorage.removeItem(key);
    } catch {
      /* private mode / quota — fail silent */
    }
  }, []);

  // ⌘K / Ctrl-K depuis n'importe où dans l'app. On ne capture pas la frappe
  // quand la palette est déjà ouverte : c'est elle qui gère alors son clavier.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, []);

  return (
    <div className="theme-backoffice flex h-screen flex-col bg-bg-base text-text-primary">
      <TopBar onOpenSearch={() => { setPaletteOpen(true); }} />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 overflow-y-auto bg-page-grid px-[22px] py-5"
      >
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => { setPaletteOpen(false); }} />
    </div>
  );
}
