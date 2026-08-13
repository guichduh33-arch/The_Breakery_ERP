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
import { Skeleton } from '@breakery/ui';
import { CommandPalette } from './CommandPalette.js';
import { TopBar } from './TopBar.js';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary.js';

const DEAD_SIDEBAR_KEYS = [
  'bo:sidebar:collapsed',
  'bo:sidebar:groups',
  'bo:sidebar:subgroups',
];

/** Shown while a route-split page chunk is being fetched (React.lazy).
 *  Une SILHOUETTE de page — bande de titre puis quelques blocs — plutôt qu'un
 *  spinner centré : l'œil garde la forme de ce qui arrive au lieu de fixer un
 *  disque qui tourne (audit UX/UI 2026-08-13, lot 8). */
function RouteFallback() {
  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-5"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="flex flex-col gap-2">
        <Skeleton width="16rem" height="1.75rem" />
        <Skeleton width="24rem" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="block" height="5.5rem" />
        ))}
      </div>
      <Skeleton variant="block" height="18rem" />
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
