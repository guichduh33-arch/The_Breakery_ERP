// apps/backoffice/src/pages/inventory/RecipeEditorPage.tsx
//
// Standalone editor at /backoffice/inventory/recipes. Lets MANAGER+ pick a
// finished product and add/remove ingredient lines.

import { useState, type JSX } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import RecipeEditor from '@/features/inventory-production/components/RecipeEditor.js';

export default function RecipeEditorPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [productId, setProductId] = useState<string | null>(null);

  if (!hasPermission('inventory.read')) {
    return <div className="text-text-secondary">You do not have permission to view recipes.</div>;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Recipes</h1>
        <p className="text-text-secondary text-sm mt-1">
          Define the Bill of Materials for each finished product. Recipes drive automatic
          ingredient consumption when a production batch is recorded.
        </p>
      </div>
      <RecipeEditor productId={productId} onProductChange={setProductId} />
    </div>
  );
}
