// apps/backoffice/src/features/products/components/ProductsPageTabs.tsx
//
// Écran 2a — onglets de zone (liste / import-export).
//
// Les capitales or à `tracking-widest` tombent : à ce niveau de la page elles
// criaient plus fort que le titre lui-même. L'onglet actif se dit par un
// soulignement or de 2 px et un poids, pas par une couleur de texte.

import type { JSX } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';

export function ProductsPageTabs(): JSX.Element {
  const canImport = useAuthStore((s) => s.hasPermission('catalog.import'));
  const tabs = [
    { to: '/backoffice/products', label: 'Products', end: true },
    ...(canImport
      ? [{ to: '/backoffice/products/import-export', label: 'Import / Export', end: false }]
      : []),
  ];
  return (
    <div className="border-b border-border-subtle">
      <nav aria-label="Products sections" className="flex flex-wrap">
        {tabs.map((t, i) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'relative -mb-px pb-2.5 text-[12.5px] transition-colors duration-fast',
                i === 0 ? 'px-0.5' : 'px-3',
                isActive
                  ? 'font-semibold text-text-primary shadow-[inset_0_-2px_0_var(--gold-base)]'
                  : 'text-text-muted hover:text-text-primary',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
