// apps/backoffice/src/pages/customers/customer-detail/PricingTab.tsx
//
// "Pricing" tab of the customer detail page: category pricing rule + custom
// price overrides table. Co-located split (S57 E-D4) — behaviour unchanged.
//
// S69 Volet A (Task 4) — the overrides table is now editable (add / inline
// edit / delete) when the viewer holds `customer_categories.update`, wired to
// upsert_product_category_price_v1 / delete_product_category_price_v1
// (Task 2). Read-only fallback (no permission, or non-custom category) is
// preserved byte-for-byte.

import { useState, type ChangeEvent, type JSX } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Card, Input, Select } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useProductsForOrderEdit } from '@/features/orders/hooks/useProductsForOrderEdit.js';
import { CustomerCategoryChip } from '@/features/customers/components/CustomerCategoryChip.js';
import {
  useCustomerCategoryPrices,
  useDeleteCategoryPrice,
  useUpsertCategoryPrice,
  type CategoryPriceOverride,
} from '@/features/customers/hooks/useCustomerCategoryPrices.js';
import type {
  CustomerDetailRow,
  PriceModifierType,
} from '@/features/customers/hooks/useCustomerDetail.js';
import { rp } from './shared.js';

const MODIFIER_LABEL: Record<PriceModifierType, string> = {
  retail: 'Retail price',
  wholesale: 'Wholesale price',
  discount_percentage: 'Percentage discount',
  custom: 'Custom price list',
};

export function PricingTab({ customer }: { customer: CustomerDetailRow }): JSX.Element {
  const category = customer.category;
  const canUpdate = useAuthStore((s) => s.hasPermission('customer_categories.update'));
  const isCustom = category?.price_modifier_type === 'custom';
  const categoryId = isCustom ? category.id : null;

  const { data: overrides, isLoading } = useCustomerCategoryPrices(categoryId);
  const upsertPrice = useUpsertCategoryPrice(categoryId);
  const deletePrice = useDeleteCategoryPrice(categoryId);
  const [error, setError] = useState<string | null>(null);

  function handleSave(productId: string, price: number): void {
    setError(null);
    upsertPrice.mutate(
      { productId, price },
      { onError: (e) => setError(e instanceof Error ? e.message : String(e)) },
    );
  }

  function handleDelete(productId: string): void {
    setError(null);
    deletePrice.mutate(productId, {
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
  }

  if (!category) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">No category assigned — this customer pays standard retail prices.</p></Card>;
  }

  const modifier = category.price_modifier_type;
  const canEditOverrides = isCustom && canUpdate;

  return (
    <div className="space-y-4">
      <Card variant="default" padding="md" className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">Pricing rule</h2>
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <CustomerCategoryChip name={category.name} slug={category.slug} />
          <span>→ {MODIFIER_LABEL[modifier]}</span>
        </div>
        {modifier === 'discount_percentage' && (
          <p className="text-sm text-text-secondary">
            {category.discount_percentage}% off retail on every product.
          </p>
        )}
        {modifier === 'wholesale' && (
          <p className="text-sm text-text-secondary">Wholesale price where defined, otherwise retail.</p>
        )}
        {modifier === 'retail' && (
          <p className="text-sm text-text-secondary">Standard retail pricing — no category discount.</p>
        )}
        <p className="pt-1 text-xs text-text-muted">
          Loyalty multiplier ×{category.points_multiplier} · loyalty {category.loyalty_enabled ? 'enabled' : 'disabled'}
        </p>
      </Card>

      {isCustom && (
        <Card variant="default" padding="none" className="overflow-hidden">
          <div className="px-4 py-3 text-xs text-text-secondary">
            {isLoading ? 'Loading overrides…' : `${overrides?.length ?? 0} custom product price(s)`}
          </div>
          <p className="px-4 pb-3 text-xs text-text-muted">
            These prices apply to every customer in this category.
          </p>
          {error !== null && (
            <div role="alert" className="mx-4 mb-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          {overrides && overrides.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <thead className="border-y border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Product</th>
                  <th className="px-4 py-2.5 text-right font-medium">Retail</th>
                  <th className="px-4 py-2.5 text-right font-medium">Custom</th>
                  {canEditOverrides && <th className="px-4 py-2.5 text-right font-medium">&nbsp;</th>}
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <OverrideRow
                    key={o.product_id}
                    override={o}
                    canEdit={canEditOverrides}
                    onSave={(price) => handleSave(o.product_id, price)}
                    onDelete={() => handleDelete(o.product_id)}
                    saving={upsertPrice.isPending || deletePrice.isPending}
                  />
                ))}
              </tbody>
            </table>
          )}

          {canEditOverrides && (
            <AddOverrideRow
              existingProductIds={new Set((overrides ?? []).map((o) => o.product_id))}
              onAdd={handleSave}
              saving={upsertPrice.isPending}
            />
          )}
        </Card>
      )}
    </div>
  );
}

function OverrideRow({
  override, canEdit, onSave, onDelete, saving,
}: {
  override: CategoryPriceOverride;
  canEdit: boolean;
  onSave: (price: number) => void;
  onDelete: () => void;
  saving: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(String(override.custom_price));
  const parsed = Number(draft);
  const isValid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  const dirty = isValid && parsed !== override.custom_price;

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    setDraft(e.target.value);
  }

  return (
    <tr className="border-t border-border-subtle">
      <td className="px-4 py-3 text-text-primary">
        {override.product_name}
        {override.product_sku && <span className="ml-2 text-xs text-text-muted">{override.product_sku}</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-text-muted line-through">{rp(override.retail_price)}</td>
      <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
        {canEdit ? (
          <div className="flex items-center justify-end gap-2">
            <Input
              aria-label={`Price for ${override.product_name}`}
              value={draft}
              inputMode="numeric"
              onChange={handleChange}
              className="w-28 text-right"
            />
            {dirty && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`Save ${override.product_name} price`}
                disabled={saving}
                onClick={() => onSave(parsed)}
              >
                Save
              </Button>
            )}
          </div>
        ) : (
          rp(override.custom_price)
        )}
      </td>
      {canEdit && (
        <td className="px-4 py-3 text-right">
          <Button
            type="button"
            variant="ghostDestructive"
            size="sm"
            aria-label={`Remove ${override.product_name} override`}
            disabled={saving}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </td>
      )}
    </tr>
  );
}

function AddOverrideRow({
  existingProductIds, onAdd, saving,
}: {
  existingProductIds: Set<string>;
  onAdd: (productId: string, price: number) => void;
  saving: boolean;
}): JSX.Element {
  const { data: products } = useProductsForOrderEdit();
  const [productId, setProductId] = useState('');
  const [price, setPrice] = useState('');

  const parsed = Number(price);
  const isPriceValid = price.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  const canAdd = productId !== '' && isPriceValid && !saving;

  const options = (products ?? []).filter((p) => !existingProductIds.has(p.id));

  function handleAdd(): void {
    if (!canAdd) return;
    onAdd(productId, parsed);
    setProductId('');
    setPrice('');
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3">
      <Select
        aria-label="Product to add"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        className="max-w-xs"
      >
        <option value="">Select a product…</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.sku})
          </option>
        ))}
      </Select>
      <Input
        aria-label="New price"
        value={price}
        inputMode="numeric"
        placeholder="Price"
        onChange={(e) => setPrice(e.target.value)}
        className="w-28"
      />
      <Button type="button" variant="secondary" size="sm" disabled={!canAdd} onClick={handleAdd}>
        Add override
      </Button>
    </div>
  );
}
