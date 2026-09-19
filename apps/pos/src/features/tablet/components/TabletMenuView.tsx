// apps/pos/src/features/tablet/components/TabletMenuView.tsx
//
// Session 13 / Phase 4.D — Tablet polish.
//
// Compose les catégories et la grille. Le cache hors ligne et le bandeau
// de connexion sont portés par le layout, également monté sur le plan de salle.

import { type JSX, type ReactNode } from 'react';
import { TabletCategorySidebar } from './TabletCategorySidebar';
import { TabletProductGrid } from './TabletProductGrid';

export interface TabletMenuViewProps {
  selectedSlug: string | null;
  /** `null` = tuile « All » du rail — tout le catalogue. */
  onSelectCategory: (slug: string | null) => void;
  /**
   * Optional toolbar rendered between the sidebar and the grid. Used by
   * the page to inject the table-picker + order-type tabs.
   */
  toolbar?: ReactNode;
}

export function TabletMenuView({ selectedSlug, onSelectCategory, toolbar }: TabletMenuViewProps): JSX.Element {
  // Le layout restaure et maintient le cache, y compris quand le plan de salle
  // est affiché et que ce menu n'est pas monté.

  return (
    <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden max-[1099px]:flex-col">
      <TabletCategorySidebar selectedSlug={selectedSlug} onSelect={onSelectCategory} />
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        {toolbar !== undefined && toolbar}
        <div className="flex-1 overflow-hidden flex">
          <TabletProductGrid selectedSlug={selectedSlug} />
        </div>
      </div>
    </div>
  );
}
