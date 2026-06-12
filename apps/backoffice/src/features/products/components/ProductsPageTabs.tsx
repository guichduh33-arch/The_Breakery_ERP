// apps/backoffice/src/features/products/components/ProductsPageTabs.tsx
// S41 — route-based tab strip for the Products area (list / import-export).
// Style mirrors ProductDetailTabs (gold underline, uppercase, tracking-widest)
// but uses NavLink for route-based active state.

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
      <nav aria-label="Products sections" className="flex flex-wrap gap-x-6">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'relative -mb-px py-3 text-xs font-semibold uppercase tracking-widest transition-colors duration-fast',
                isActive
                  ? 'text-gold border-b-2 border-gold'
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
