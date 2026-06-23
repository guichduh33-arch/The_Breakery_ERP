// apps/backoffice/src/pages/IncomingStock.tsx
//
// Standalone page at /backoffice/inventory/incoming. Records an ACCOUNTED direct
// purchase (without first drafting a PO): it routes through the Purchasing
// money-path so the buy integrates with stock, WAC, the stock analytics AND the
// accounting ledger. Gated on `purchasing.po.create` (the buy needs it).
//
// Session 14 / Phase 5.A — header polish. 2026-06-23 — replaced the free-form
// incoming receipt with the accounted DirectPurchaseForm.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore.js';
import DirectPurchaseForm from '@/features/inventory/components/DirectPurchaseForm.js';

export default function IncomingStockPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (!hasPermission('purchasing.po.create')) {
    return <div className="text-text-secondary">You do not have permission to record purchases.</div>;
  }
  return (
    <div className="space-y-6">
      <Link
        to="/backoffice/inventory"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to Stock &amp; Inventory
      </Link>
      <header>
        <h1 className="font-display text-3xl text-text-primary">Incoming Stock — Direct Purchase</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Record a supplier purchase that posts straight to stock, weighted-average cost,
          the stock analytics and the accounting ledger (Inventory · Payable · Cash/Bank).
        </p>
      </header>
      <DirectPurchaseForm />
    </div>
  );
}
