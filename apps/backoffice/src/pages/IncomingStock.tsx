// apps/backoffice/src/pages/IncomingStock.tsx
//
// Standalone page at /backoffice/inventory/incoming. Lets a user record a
// free-form stock receipt that isn't tied to a purchase order — supplier is
// optional. Permission-gated on `inventory.receive`.
//
// Session 14 / Phase 5.A — header polish: Fraunces title + branded breadcrumb,
// matching the rebuilt purchasing surfaces. Form behaviour unchanged.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore.js';
import IncomingStockForm from '@/features/inventory/components/IncomingStockForm.js';

export default function IncomingStockPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (!hasPermission('inventory.receive')) {
    return <div className="text-text-secondary">You do not have permission to record incoming stock.</div>;
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
        <h1 className="font-display text-3xl text-text-primary">Incoming Stock</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Record stock receipts that aren&apos;t tied to a purchase order. Supplier optional.
        </p>
      </header>
      <IncomingStockForm />
    </div>
  );
}
