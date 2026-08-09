// apps/backoffice/src/features/products/hooks/useProductPerformance.ts
//
// Les ventes d'un produit sur une fenêtre de jours métier, câblées sur
// `get_product_performance_v1`.
//
// Pourquoi pas `useProductDashboard` : celui-là sert le STOCK. Son
// `summary.units_sold` somme les mouvements `sale` ET `production_out` — donc
// « sorti », pas « vendu » —, il n'expose aucun revenu, et il est gaté
// `inventory.read`. Les deux hooks coexistent parce qu'ils répondent à deux
// questions différentes sur le même produit.
//
// Le gate serveur est `reports.sales.read`, que CASHIER et waiter n'ont pas :
// un 42501 n'est donc PAS une erreur à peindre en rouge, c'est « cette carte ne
// vous est pas destinée ». On le classe pour que la fiche dégrade carte par
// carte au lieu de tomber en entier — même traitement que les panneaux du
// dashboard, dont on réutilise le classificateur plutôt que d'en recopier un.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { isRestricted } from '@/features/dashboard/hooks/useDashboardPanels.js';

export { isRestricted };

/** Les trois mesures, déclinées à l'identique pour le total et chaque canal. */
export interface ProductPerformanceChannel {
  units_sold:          number;
  revenue:             number;
  orders_with_product: number;
  orders_total:        number;
  conversion_pct:      number;
}

export interface ProductPerformance {
  product_id:   string;
  window_days:  number;
  from_date:    string;
  to_date:      string;
  timezone:     string;
  generated_at: string;
  total:        ProductPerformanceChannel;
  /** Ventes comptoir — le périmètre exact du rapport Top products. */
  counter:      ProductPerformanceChannel;
  b2b:          ProductPerformanceChannel;
}

export function productPerformanceKey(productId: string | null, days: number) {
  return ['product-performance', productId, days] as const;
}

/** Code porté par une réponse dont la forme n'est pas celle attendue. */
export const PAYLOAD_ERROR_CODE = 'PRODUCT_PERFORMANCE_PAYLOAD';

/**
 * Validation à la frontière : `supabase.rpc` est typé `Json`, donc rien ne
 * garantit la forme au compilateur. Une enveloppe incomplète qu'on laisserait
 * passer ferait planter la carte au premier `total.units_sold` — et un composant
 * qui plante emporte la fiche entière. On refuse ici, et la carte rend
 * « indisponible » : un inconnu affiché, jamais un zéro, jamais un écran blanc.
 */
function isEnvelope(d: unknown): d is ProductPerformance {
  if (d === null || typeof d !== 'object') return false;
  const e = d as Partial<ProductPerformance>;
  return (['total', 'counter', 'b2b'] as const).every((k) => {
    const c = e[k];
    return c !== null && typeof c === 'object' && typeof c.units_sold === 'number';
  });
}

export function useProductPerformance(
  productId: string | null,
  days = 30,
  enabled = true,
) {
  return useQuery<ProductPerformance | null, Error>({
    queryKey: productPerformanceKey(productId, days),
    enabled: enabled && productId !== null,
    staleTime: 60_000,
    // Ni un refus de droit ni une réponse malformée ne se retentent : aucun des
    // deux ne changera au deuxième essai.
    retry: (count, err) => {
      if (isRestricted(err)) return false;
      if ((err as { code?: string }).code === PAYLOAD_ERROR_CODE) return false;
      return count < 2;
    },
    queryFn: async () => {
      if (productId === null) return null;
      const { data, error } = await supabase.rpc('get_product_performance_v1', {
        p_product_id: productId,
        p_days:       days,
      });
      if (error !== null) throw Object.assign(new Error(error.message), { code: error.code });
      if (!isEnvelope(data)) {
        throw Object.assign(
          new Error('unexpected get_product_performance_v1 payload'),
          { code: PAYLOAD_ERROR_CODE },
        );
      }
      return data;
    },
  });
}
