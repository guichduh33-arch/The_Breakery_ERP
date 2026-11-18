// apps/pos/src/features/lan/hooks/useQuarantinedPayments.ts
//
// S3-17 — ADR-018 D5 : un intent de RÈGLEMENT mis en quarantaine lève une
// alerte caisse qui ne se referme pas d'elle-même. Ce crochet lit le registre
// durable (`getQuarantinedIntents`, lecture seule — D4/D6 : ni purge, ni
// rejeu forcé) et ne garde que les règlements (`payment` et l'ancien
// `cash_payment`, toujours lu : format append-only).
//
// Poll modeste comme useOfflinePendingCount : le registre n'émet aucun
// événement inter-onglets. `useOfflineReplay` invalide aussi la clé dès qu'un
// rejeu rapporte une quarantaine, pour une alerte immédiate.

import { useQuery } from '@tanstack/react-query';
import {
  getQuarantinedIntents,
  type OfflineCashPaymentIntent,
  type OfflinePaymentIntent,
  type QuarantinedIntent,
} from '../offlineOutbox';

export const QUARANTINE_QUERY_KEY = ['offline', 'quarantine'] as const;

export type QuarantinedPayment = QuarantinedIntent & {
  intent: OfflinePaymentIntent | OfflineCashPaymentIntent;
};

export function isQuarantinedPayment(row: QuarantinedIntent): row is QuarantinedPayment {
  return row.intent.kind === 'payment' || row.intent.kind === 'cash_payment';
}

export function useQuarantinedPayments(): QuarantinedPayment[] {
  const { data } = useQuery({
    queryKey: QUARANTINE_QUERY_KEY,
    queryFn: async () => (await getQuarantinedIntents()).filter(isQuarantinedPayment),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  return data ?? [];
}
