// apps/backoffice/src/features/suppliers/hooks/useSupplierMetrics.ts
//
// Session 14 — Phase 5.A — Aggregate KPIs derived client-side from a list of
// supplier purchase orders. Pure, ergonomic helper consumed by the header
// tiles on SupplierDetailPage.
//
// S3-07 — l'impayé et le payé ne se calculent plus ici : l'ancienne heuristique
// (`payment_terms` + statut du bon) comptait « payé » un bon à crédit reçu et
// jamais réglé, et portait sur les 100 lignes affichées seulement. Ils viennent
// désormais du grand livre via `useSupplierOutstanding`.

import { useMemo } from 'react';
import type { SupplierPOListRow } from './useSupplierPurchases.js';

export interface SupplierMetrics {
  /** Number of POs (regardless of status). */
  poCount: number;
  /** Sum of total_amount across non-cancelled POs. */
  totalSpent: number;
  /** Average lead time (received_date - order_date) in days. NaN when none. */
  avgLeadDays: number;
}

export function useSupplierMetrics(rows: readonly SupplierPOListRow[]): SupplierMetrics {
  return useMemo(() => {
    let totalSpent = 0;
    let leadDaysSum = 0;
    let leadCount = 0;
    for (const r of rows) {
      if (r.status === 'cancelled') continue;
      totalSpent += Number(r.total_amount ?? 0);
      if (r.received_date !== null && r.order_date !== null) {
        const ms = new Date(r.received_date).getTime() - new Date(r.order_date).getTime();
        if (Number.isFinite(ms) && ms >= 0) {
          leadDaysSum += ms / (1000 * 60 * 60 * 24);
          leadCount += 1;
        }
      }
    }
    return {
      poCount: rows.length,
      totalSpent,
      avgLeadDays: leadCount === 0 ? Number.NaN : leadDaysSum / leadCount,
    };
  }, [rows]);
}
