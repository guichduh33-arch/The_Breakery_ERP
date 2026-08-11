// apps/pos/src/features/settings/hooks/useOrgDisplaySettings.ts
//
// S73 Lot 2 — org-level customer-display copy + payment auto-toggles, read
// straight off business_config (RLS auth_read; kiosk JWT on the paired
// display). Degrades to the built-in defaults while loading / on error — a
// config read must never block an encaissement (pattern: useTaxConfig).
// Writes go through set_setting_v12 (settings.update gate, audit-logged).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

const QUERY_KEY = ['business-config', 'org-display-settings'] as const;

export interface OrgDisplaySettings {
  displayFooterMessage: string;
  displaySlogan: string;
  autoPrint: boolean;
  autoOpenDrawer: boolean;
  /** ADR-023 déc. 2 — sélection ORDONNÉE des produits mis en vitrine au repos. */
  showcaseProductIds: string[];
  /** ADR-023 déc. 3 — file de retrait sur l'écran client. Éteinte par défaut. */
  showReadyOrders: boolean;
}

const DEFAULTS: OrgDisplaySettings = {
  displayFooterMessage: '',
  displaySlogan: '',
  autoPrint: true,
  autoOpenDrawer: true,
  showcaseProductIds: [],
  showReadyOrders: false,
};

/** Plafond de la sélection, miroir du CHECK porté par business_config. */
export const SHOWCASE_MAX_PRODUCTS = 12;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La colonne est typée `Json` : rien ne garantit sa forme au type-check. On la
 * valide ici plutôt que de la caster — un id malformé partirait sinon dans un
 * `.in('id', …)` et ferait échouer la requête produits, donc disparaître toute
 * la vitrine pour une seule entrée abîmée. Doublons écartés, ordre conservé.
 */
export function parseShowcaseProductIds(raw: Json | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string' || !UUID_RE.test(entry)) continue;
    seen.add(entry.toLowerCase());
    if (seen.size >= SHOWCASE_MAX_PRODUCTS) break;
  }
  return [...seen];
}

export function useOrgDisplaySettings(): OrgDisplaySettings & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 5 * 60_000,
    // Bound the offline wait: SuccessModal's fire-once effect is gated on
    // isLoading, so react-query's default 3-retry exponential backoff would
    // stall the drawer/print for tens of seconds when the network is down.
    // One retry, then settle (error clears isLoading → DEFAULTS apply).
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_config')
        .select(
          'display_footer_message, display_slogan, pos_auto_print_receipt, pos_auto_open_drawer, display_showcase_product_ids, display_show_ready_orders',
        )
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  return {
    displayFooterMessage: data?.display_footer_message ?? DEFAULTS.displayFooterMessage,
    displaySlogan: data?.display_slogan ?? DEFAULTS.displaySlogan,
    autoPrint: data?.pos_auto_print_receipt ?? DEFAULTS.autoPrint,
    autoOpenDrawer: data?.pos_auto_open_drawer ?? DEFAULTS.autoOpenDrawer,
    showcaseProductIds: parseShowcaseProductIds(data?.display_showcase_product_ids),
    // Éteint tant que la config n'a pas répondu : c'est le défaut qui porte la
    // décision 1 d'ADR-023, un repli allumé ferait clignoter la file au montage.
    showReadyOrders: data?.display_show_ready_orders ?? DEFAULTS.showReadyOrders,
    isLoading,
  };
}

export function useSetOrgDisplaySetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value, category }: {
      key: 'display_footer_message' | 'display_slogan' | 'pos_auto_print_receipt' | 'pos_auto_open_drawer'
        | 'kot_copies_barista' | 'kot_copies_kitchen' | 'kot_copies_display';
      value: string | boolean | number;
      category: 'customer_display' | 'printing';
    }) => {
      const { error } = await supabase.rpc('set_setting_v12', {
        p_key: key,
        p_value: value as unknown as Json,
        p_category: category,
      });
      if (error) throw error;
    },
    // Invalidate the shared business_config prefix: covers this hook's key AND
    // useKotCopies (['business-config', 'kot-copies']) in one shot.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['business-config'] }),
  });
}
