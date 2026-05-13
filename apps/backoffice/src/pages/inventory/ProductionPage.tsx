// apps/backoffice/src/pages/inventory/ProductionPage.tsx
//
// Standalone page at /backoffice/inventory/production. Combines:
//   - ProductionForm (record a new batch)
//   - ProductionSuggestions (recommendations)
//   - ProductionRecordList (recent batches with revert action)

import type { JSX } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import ProductionForm from '@/features/inventory-production/components/ProductionForm.js';
import ProductionSuggestions from '@/features/inventory-production/components/ProductionSuggestions.js';
import ProductionRecordList from '@/features/inventory-production/components/ProductionRecordList.js';

export default function ProductionPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (!hasPermission('inventory.read')) {
    return <div className="text-text-secondary">You do not have permission to view production.</div>;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Production</h1>
        <p className="text-text-secondary text-sm mt-1">
          Record production batches that consume ingredients per active recipes and credit
          finished-goods stock. Reverts (admin only) restore both sides.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">Record a batch</h2>
        <ProductionForm />
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">Suggestions</h2>
        <ProductionSuggestions />
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl">Recent productions</h2>
        <ProductionRecordList />
      </section>
    </div>
  );
}
