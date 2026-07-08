// apps/backoffice/src/features/customers/components/NegotiatedPricesSection.tsx
//
// S69 Volet B (Task 8) — per-customer negotiated product prices. Unlike the
// category overrides table (PricingTab, applies to every customer sharing a
// category), these rows are scoped to a single customer and take priority
// server-side: create_b2b_order_v5 resolves negotiated (customer) >
// category > retail. Mirrors the editable-table pattern shipped for category
// overrides in Task 4 (add / inline edit / delete), gated on
// customer_prices.manage instead of customer_categories.update.

import { useState, type ChangeEvent, type JSX } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Card, Input, Select } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useProductsForOrderEdit } from '@/features/orders/hooks/useProductsForOrderEdit.js';
import {
  useCustomerNegotiatedPrices,
  useDeleteNegotiatedPrice,
  useUpsertNegotiatedPrice,
  type NegotiatedPrice,
} from '../hooks/useCustomerNegotiatedPrices.js';

export interface NegotiatedPricesSectionProps {
  customerId: string;
}

export function NegotiatedPricesSection({ customerId }: NegotiatedPricesSectionProps): JSX.Element {
  const canManage = useAuthStore((s) => s.hasPermission('customer_prices.manage'));

  const { data: prices, isLoading } = useCustomerNegotiatedPrices(customerId);
  const upsertPrice = useUpsertNegotiatedPrice(customerId);
  const deletePrice = useDeleteNegotiatedPrice(customerId);
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

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-text-secondary">
          Negotiated prices (this customer)
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          Applied automatically to this customer&apos;s B2B orders.
        </p>
      </div>
      <div className="px-4 pb-3 text-xs text-text-secondary">
        {isLoading ? 'Loading negotiated prices…' : `${prices?.length ?? 0} negotiated price(s)`}
      </div>
      {error !== null && (
        <div role="alert" className="mx-4 mb-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {prices && prices.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead className="border-y border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Product</th>
              <th className="px-4 py-2.5 text-right font-medium">Retail</th>
              <th className="px-4 py-2.5 text-right font-medium">Negotiated</th>
              {canManage && <th className="px-4 py-2.5 text-right font-medium">&nbsp;</th>}
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <NegotiatedPriceRow
                key={p.product_id}
                price={p}
                canEdit={canManage}
                onSave={(price) => handleSave(p.product_id, price)}
                onDelete={() => handleDelete(p.product_id)}
                saving={upsertPrice.isPending || deletePrice.isPending}
              />
            ))}
          </tbody>
        </table>
      )}

      {canManage && (
        <AddNegotiatedPriceRow
          existingProductIds={new Set((prices ?? []).map((p) => p.product_id))}
          onAdd={handleSave}
          saving={upsertPrice.isPending}
        />
      )}
    </Card>
  );
}

function NegotiatedPriceRow({
  price, canEdit, onSave, onDelete, saving,
}: {
  price: NegotiatedPrice;
  canEdit: boolean;
  onSave: (price: number) => void;
  onDelete: () => void;
  saving: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(String(price.negotiated_price));
  const parsed = Number(draft);
  const isValid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  const dirty = isValid && parsed !== price.negotiated_price;

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    setDraft(e.target.value);
  }

  return (
    <tr className="border-t border-border-subtle">
      <td className="px-4 py-3 text-text-primary">
        {price.product_name}
        {price.product_sku && <span className="ml-2 text-xs text-text-muted">{price.product_sku}</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-text-muted line-through">{formatIdr(price.retail_price)}</td>
      <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
        {canEdit ? (
          <div className="flex items-center justify-end gap-2">
            <Input
              aria-label={`Price for ${price.product_name}`}
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
                aria-label={`Save ${price.product_name} price`}
                disabled={saving}
                onClick={() => onSave(parsed)}
              >
                Save
              </Button>
            )}
          </div>
        ) : (
          formatIdr(price.negotiated_price)
        )}
      </td>
      {canEdit && (
        <td className="px-4 py-3 text-right">
          <Button
            type="button"
            variant="ghostDestructive"
            size="sm"
            aria-label={`Remove ${price.product_name} negotiated price`}
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

function AddNegotiatedPriceRow({
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
        Add negotiated price
      </Button>
    </div>
  );
}
