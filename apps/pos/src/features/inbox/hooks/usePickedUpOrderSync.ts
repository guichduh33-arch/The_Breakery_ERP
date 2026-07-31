// apps/pos/src/features/inbox/hooks/usePickedUpOrderSync.ts
//
// Conséquence directe de la décision « une seule addition tant que ce n'est pas
// payé » (2026-08-01) : une serveuse peut ajouter une tournée à une commande de
// salle que le caissier tient DÉJÀ dans son panier.
//
// L'argent n'est pas en danger — `pay_existing_order` recalcule le total depuis
// les lignes en base et REFUSE un règlement dont la somme ne correspond pas. Le
// caissier ne peut donc pas sous-facturer. Mais sans ce hook il se prendrait un
// refus incompréhensible au moment d'encaisser, sans jamais avoir vu arriver le
// dessert. On recharge donc les lignes et on le dit.
//
// Le panier reste la source d'affichage ; c'est la base qui fait foi.

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { CartItem } from '@breakery/domain';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';

interface OrderItemRow {
  id: string;
  product_id: string;
  name_snapshot: string;
  unit_price: number;
  quantity: number;
  modifiers: unknown;
}

function toCartItem(row: OrderItemRow): CartItem {
  return {
    id: row.id,
    product_id: row.product_id,
    name: row.name_snapshot,
    unit_price: row.unit_price,
    quantity: row.quantity,
    modifiers: (row.modifiers as CartItem['modifiers']) ?? [],
  };
}

export function usePickedUpOrderSync(): void {
  const pickedUpOrderId = useCartStore((s) => s.pickedUpOrderId);
  // Évite un toast au montage : on ne signale que ce qui ARRIVE après la reprise.
  const knownIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (pickedUpOrderId === null) {
      knownIdsRef.current = null;
      return undefined;
    }

    knownIdsRef.current = new Set(useCartStore.getState().cart.items.map((i) => i.id));

    async function reload(): Promise<void> {
      const { data, error } = await supabase
        .from('order_items')
        .select('id, product_id, name_snapshot, unit_price, quantity, modifiers')
        .eq('order_id', pickedUpOrderId!)
        .eq('is_cancelled', false);
      if (error) return;

      const rows = (data as unknown as OrderItemRow[]) ?? [];
      const known = knownIdsRef.current ?? new Set<string>();
      const fresh = rows.filter((r) => !known.has(r.id));
      if (fresh.length === 0) return;

      const items = rows.map(toCartItem);
      const store = useCartStore.getState();
      // Les lignes d'une commande de salle sont verrouillées dès leur création :
      // le panier doit les reprendre comme telles, sinon le caissier pourrait
      // les éditer sans le flux manager (ADR-010).
      store.restoreCart({
        items,
        order_type: store.cart.order_type,
        ...(store.cart.tableNumber ? { tableNumber: store.cart.tableNumber } : {}),
      });
      store.markLocked(items.map((i) => i.id));
      store.setPickedUpOrderId(pickedUpOrderId!);
      knownIdsRef.current = new Set(rows.map((r) => r.id));

      const names = fresh.map((r) => r.name_snapshot).join(', ');
      toast.info(`Nouvel article en salle : ${names}`);
    }

    // Nom de canal unique par montage — StrictMode double-monte et deux canaux
    // homonymes se télescopent en silence (cf. useKdsRealtime).
    const channel = supabase
      .channel(`picked-up-order-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_items',
          filter: `order_id=eq.${pickedUpOrderId}`,
        },
        () => { void reload(); },
      )
      .subscribe();

    // Filet : un événement perdu pendant un blip Wi-Fi ne doit pas laisser le
    // caissier devant un refus d'encaissement inexplicable.
    const interval = setInterval(() => { void reload(); }, 20_000);

    return () => {
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [pickedUpOrderId]);
}
