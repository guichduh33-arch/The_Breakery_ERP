// apps/backoffice/src/pages/IncomingStock.tsx
//
// Standalone page at /backoffice/inventory/incoming. Lets a user record a
// free-form stock receipt that isn't tied to a purchase order — supplier is
// optional. Permission-gated on `inventory.receive`.
//
// Spec ref: docs/superpowers/specs/2026-05-11-session-12-inventory-mvp-spec.md
//           Phase 2 — Incoming Stock UI

import type { JSX } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import IncomingStockForm from '@/features/inventory/components/IncomingStockForm.js';

export default function IncomingStockPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (!hasPermission('inventory.receive')) {
    return <div className="text-text-secondary">You do not have permission to record incoming stock.</div>;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Incoming Stock</h1>
        <p className="text-text-secondary text-sm mt-1">
          Record stock receipts that aren&apos;t tied to a purchase order. Supplier optional.
        </p>
      </div>
      <IncomingStockForm />
    </div>
  );
}
