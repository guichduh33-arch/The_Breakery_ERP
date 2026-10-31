import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

// Le signal ne transporte aucune vente : chaque libération ou reverrouillage
// efface les anciennes réponses avant une nouvelle lecture autorisée.
export function useProductSalesVisibilityRealtime(enabled: boolean): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return undefined;
    const reset = (): void => {
      void client.resetQueries({ queryKey: ['sales-by-product'] });
      void client.resetQueries({ queryKey: ['product-sales-lines'] });
    };
    const channel = supabase.channel(`product-sales-visibility-${crypto.randomUUID()}`)
      .on('postgres_changes' as never,
        { event: 'UPDATE', schema: 'public', table: 'ui_invalidation_topics', filter: 'topic=eq.orders' } as never,
        reset)
      .subscribe((status: string) => { if (status === 'SUBSCRIBED') reset(); });
    return () => { void supabase.removeChannel(channel); };
  }, [client, enabled]);
}
