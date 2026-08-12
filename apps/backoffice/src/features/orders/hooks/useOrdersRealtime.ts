// apps/backoffice/src/features/orders/hooks/useOrdersRealtime.ts
// Session 33 / Wave 2.4 — Realtime subscription on public.orders.
// StrictMode-safe via unique channel name per mount (CLAUDE.md critical
// pattern: "Realtime channel names must be unique per mount").
//
// Review PR #367 — l'invalidation est DÉBOUNCÉE (bord d'attaque + traîne 2 s).
// Une commande émet un INSERT plus une transition de statut par étape
// (~3-5 événements), et chaque invalidation coûte désormais DEUX RPC (lignes
// + compteurs agrégés sur toute la fenêtre). Sans coalescence, dix commandes
// dans la minute de rush déclenchaient des dizaines d'agrégats dos à dos par
// onglet ouvert. Le premier événement invalide immédiatement ; les suivants
// dans la fenêtre de 2 s sont fusionnés en une seule invalidation traînante.

import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

const COALESCE_MS = 2_000;

export function useOrdersRealtime() {
  const queryClient = useQueryClient();
  const id = useId();
  const [isConnected, setConnected] = useState(false);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['orders', 'list'] });
    };
    const onEvent = (): void => {
      if (timerRef.current === null) {
        // Bord d'attaque : le premier événement rafraîchit tout de suite.
        invalidate();
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (pendingRef.current) {
            pendingRef.current = false;
            onEvent();
          }
        }, COALESCE_MS);
      } else {
        // Fenêtre ouverte : on note, la traîne rejouera une seule fois.
        pendingRef.current = true;
      }
    };

    const channelName = `orders-list-${id}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        onEvent,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        onEvent,
      )
      .subscribe((status) => setConnected((status as string) === 'SUBSCRIBED'));

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  return { isConnected };
}
