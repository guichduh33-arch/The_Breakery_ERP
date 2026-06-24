// apps/pos/src/features/tablet/components/TabletMenuView.tsx
//
// Session 13 / Phase 4.D — Tablet polish.
//
// Composes the category sidebar + product grid with the offline cache
// seam grafted in. Renders to fill its parent's flexbox; the offline
// banner is rendered by the parent page so it can sit above the whole
// shell (including the header toolbar).
//
// Strategy:
//   - Mount the cache writer so any successful fetch of `['products']` /
//     `['categories']` is persisted to localStorage.
//   - On first render, if a cached snapshot exists and the live queries
//     are not yet populated, seed React-Query with the cached arrays so
//     the grid renders immediately even if the network is dead. The live
//     query keeps trying in the background and will overwrite the seed.
//
// Visual behaviour is identical to the cashier flow. The seeding logic is
// invisible to users.

import { useEffect, type JSX, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Category, Product } from '@breakery/domain';
import { TabletCategorySidebar } from './TabletCategorySidebar';
import { TabletProductGrid } from './TabletProductGrid';
import { useTabletMenuCacheRead, useTabletMenuCacheWriter } from '../hooks/useTabletMenuCache';

export interface TabletMenuViewProps {
  selectedSlug: string | null;
  onSelectCategory: (slug: string) => void;
  /**
   * Optional toolbar rendered between the sidebar and the grid. Used by
   * the page to inject the table-picker + order-type tabs.
   */
  toolbar?: ReactNode;
}

export function TabletMenuView({ selectedSlug, onSelectCategory, toolbar }: TabletMenuViewProps): JSX.Element {
  useTabletMenuCacheWriter();
  const qc = useQueryClient();
  const cache = useTabletMenuCacheRead();

  useEffect(() => {
    if (cache.cachedAt === null) return;
    const existingProducts   = qc.getQueryData<Product[]>(['products']);
    const existingCategories = qc.getQueryData<Category[]>(['categories']);
    if (existingProducts === undefined && cache.cachedProducts.length > 0) {
      qc.setQueryData<Product[]>(['products'], cache.cachedProducts);
    }
    if (existingCategories === undefined && cache.cachedCategories.length > 0) {
      qc.setQueryData<Category[]>(['categories'], cache.cachedCategories);
    }
  }, [qc, cache.cachedAt, cache.cachedProducts, cache.cachedCategories]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <TabletCategorySidebar selectedSlug={selectedSlug} onSelect={onSelectCategory} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {toolbar !== undefined && toolbar}
        <div className="flex-1 overflow-hidden flex">
          <TabletProductGrid selectedSlug={selectedSlug} />
        </div>
      </div>
    </div>
  );
}
