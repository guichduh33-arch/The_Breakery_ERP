// apps/backoffice/src/features/suppliers/hooks/useSupplierMetrics.ts
//
// Session 14 — Phase 5.A — Aggregate KPIs derived client-side from a list of
// supplier purchase orders. Pure, ergonomic helper consumed by the header
// tiles on SupplierDetailPage and by the Suppliers grid (where we want a
// per-card "spend" overlay later).

import { useMemo } from 'react';
import type { SupplierPOListRow } from './useSupplierPurchases.js';

export interface SupplierMetrics {
  /** Number of POs (regardless of status). */
  poCount: number;
  /** Sum of total_amount across all POs. */
  totalSpent: number;
  /** Sum of total_amount for POs with payment_terms = 'credit' and not received_date. */
  unpaidAmount: number;
  /** Sum of total_amount for POs with payment_terms = 'cash' OR received_date != null. */
  paidAmount: number;
  /** Average lead time (received_date - order_date) in days. NaN when none. */
  avgLeadDays: number;
}

export function useSupplierMetrics(rows: ReadonlyArray<SupplierPOListRow>): SupplierMetrics {
  return useMemo(() => {
    let totalSpent = 0;
    let unpaid = 0;
    let paid = 0;
    let leadDaysSum = 0;
    let leadCount = 0;
    for (const r of rows) {
      if (r.status === 'cancelled') continue;
      const amt = Number(r.total_amount ?? 0);
      totalSpent += amt;
      const isUnpaid = r.payment_terms === 'credit' && (r.received_date === null || r.status === 'pending' || r.status === 'partial');
      if (isUnpaid) unpaid += amt;
      else paid += amt;
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
      unpaidAmount: unpaid,
      paidAmount: paid,
      avgLeadDays: leadCount === 0 ? Number.NaN : leadDaysSum / leadCount,
    };
  }, [rows]);
}
