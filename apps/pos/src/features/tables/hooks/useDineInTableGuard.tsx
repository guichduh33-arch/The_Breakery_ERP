// apps/pos/src/features/tables/hooks/useDineInTableGuard.tsx
//
// Fiche 02 D2.5 (exigence propriétaire 2026-07-07) — table OBLIGATOIRE en dine-in.
// Garde partagée par les deux points d'engagement d'une commande dine-in :
//   - Send to Kitchen (le KOT part avec le n° de table) — SendToKitchenButton
//   - Checkout (paiement direct sans fire) — BottomActionBar
// ensureTable() rend true quand l'action peut continuer ; sinon il ouvre le plan
// de salle et rend false. À la sélection, la table est posée sur le panier puis
// onSelected(table) permet à l'appelant de reprendre l'action interrompue.
// Le serveur porte le même filet : fire_counter_order_v4 rejette la CRÉATION
// dine-in sans table ('table_required_for_dine_in' P0011, migration _122).

import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import { useCartStore } from '@/stores/cartStore';
import { useRestaurantTables } from './useRestaurantTables';
import { useTableOccupancy } from './useTableOccupancy';
import { FloorPlanModal } from '@/features/floor-plan/FloorPlanModal';

export interface UseDineInTableGuardResult {
  /** True = pas dine-in ou table déjà posée → l'action continue. False = plan de salle ouvert. */
  ensureTable: () => boolean;
  /** À rendre par le composant hôte (instance dédiée du FloorPlanModal). */
  modal: JSX.Element;
}

/**
 * Inner component so the data hooks (tables + realtime occupancy) only mount
 * once the guard actually trips — a SendToKitchenButton / checkout CTA that
 * never blocks must not open a realtime channel (and the fire smoke tests
 * mock supabase without .channel).
 */
function GuardFloorPlan({
  onClose,
  onSelected,
}: {
  onClose: () => void;
  onSelected?: ((tableName: string) => void) | undefined;
}): JSX.Element {
  const { data: tables = [] } = useRestaurantTables();
  const occupancy = useTableOccupancy();
  return (
    <FloorPlanModal
      open
      onClose={onClose}
      onSelect={(name) => {
        useCartStore.getState().setTableNumber(name);
        if (name) onSelected?.(name);
      }}
      tables={tables}
      occupancy={occupancy}
      initialSelection={null}
    />
  );
}

export function useDineInTableGuard(opts?: {
  /** Appelé après la pose de la table choisie — reprise de l'action bloquée. */
  onSelected?: (tableName: string) => void;
}): UseDineInTableGuardResult {
  const [open, setOpen] = useState(false);

  function ensureTable(): boolean {
    const { cart } = useCartStore.getState();
    if (cart.order_type !== 'dine_in' || cart.tableNumber) return true;
    toast.warning('Dine-in orders need a table — pick one on the floor plan');
    setOpen(true);
    return false;
  }

  const modal = open ? (
    <GuardFloorPlan onClose={() => setOpen(false)} onSelected={opts?.onSelected} />
  ) : (
    <></>
  );

  return { ensureTable, modal };
}
