// apps/backoffice/src/features/inventory/hooks/useInventoryReferenceData.ts
//
// Listes de référence du domaine stock : catégories et fournisseurs actifs.
//
// Les deux partent ensemble parce que les FORMULAIRES DE RÉCEPTION
// (`IncomingStockForm`, `DirectPurchaseForm`) affichent les deux selects d'un
// coup, et qu'un chargement séparé les faisait clignoter vides.
//
// La liste de stock, elle, n'utilise plus que les catégories : son modal de
// réception a été retiré à l'audit du 2026-07-27, la réception valorisée
// passant par /inventory/incoming. Elle paie donc une requête `suppliers`
// qu'elle n'affiche pas. C'est assumé : la table est minuscule, le résultat est
// partagé entre les trois écrans sous la même clé et retenu 5 minutes, et
// scinder le hook coûterait plus en surface qu'il ne gagne en octets.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CategoryOption {
  id:   string;
  name: string;
}

export interface SupplierOption {
  id:   string;
  code: string;
  name: string;
}

interface ReferenceData {
  categories: CategoryOption[];
  suppliers:  SupplierOption[];
}

export function useInventoryReferenceData() {
  return useQuery<ReferenceData>({
    queryKey: ['inventory-bo', 'reference-data'] as const,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [categories, suppliers] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order'),
        supabase
          .from('suppliers')
          .select('id, code, name')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('name'),
      ]);

      if (categories.error) throw categories.error;
      if (suppliers.error)  throw suppliers.error;

      return {
        categories: categories.data ?? [],
        suppliers:  suppliers.data  ?? [],
      };
    },
  });
}
