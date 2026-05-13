// apps/backoffice/src/features/inventory-alerts/components/AlertsBadge.tsx
// Session 13 / Phase 2.D — topbar badge showing total active alerts.
//
// Sum of :
//   - get_low_stock_v1 row count (global mode)
//   - get_reorder_suggestions_v1 row count
//   - get_expiring_lots_v1 row count (24h ahead)
//
// Clicks → /backoffice/inventory/alerts.

import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useLowStock } from '../hooks/useLowStock.js';
import { useReorderSuggestions } from '../hooks/useReorderSuggestions.js';
import { useExpiringLots } from '@/features/inventory/hooks/useExpiringLots.js';

export function AlertsBadge() {
  const low      = useLowStock(null);
  const reorder  = useReorderSuggestions(30, 14);
  const expiring = useExpiringLots({ hoursAhead: 24 });

  const total = (low.data?.length ?? 0) + (reorder.data?.length ?? 0) + (expiring.data?.length ?? 0);

  if (total === 0) {
    return (
      <Link
        to="/backoffice/inventory/alerts"
        className="relative inline-flex items-center justify-center w-8 h-8 rounded text-text-secondary hover:text-text-primary hover:bg-bg-overlay"
        aria-label="No inventory alerts"
      >
        <Bell className="h-4 w-4" aria-hidden />
      </Link>
    );
  }

  return (
    <Link
      to="/backoffice/inventory/alerts"
      className="relative inline-flex items-center justify-center w-8 h-8 rounded text-amber-600 hover:text-amber-700 hover:bg-bg-overlay"
      aria-label={`${total} active inventory alerts`}
      title={`${low.data?.length ?? 0} low-stock / ${reorder.data?.length ?? 0} reorder / ${expiring.data?.length ?? 0} expiring`}
    >
      <Bell className="h-4 w-4" aria-hidden />
      <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center">
        {total > 99 ? '99+' : total}
      </span>
    </Link>
  );
}
