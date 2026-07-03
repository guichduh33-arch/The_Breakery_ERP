// apps/backoffice/src/pages/customers/customer-detail/PricingTab.tsx
//
// "Pricing" tab of the customer detail page: category pricing rule + custom
// price overrides table. Co-located split (S57 E-D4) — behaviour unchanged.

import type { JSX } from 'react';
import { Card } from '@breakery/ui';
import { CustomerCategoryChip } from '@/features/customers/components/CustomerCategoryChip.js';
import {
  useCustomerCategoryPrices,
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
  const { data: overrides, isLoading } = useCustomerCategoryPrices(
    category?.price_modifier_type === 'custom' ? category.id : null,
  );

  if (!category) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">No category assigned — this customer pays standard retail prices.</p></Card>;
  }

  const modifier = category.price_modifier_type;

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

      {modifier === 'custom' && (
        <Card variant="default" padding="none" className="overflow-hidden">
          <div className="px-4 py-3 text-xs text-text-secondary">
            {isLoading ? 'Loading overrides…' : `${overrides?.length ?? 0} custom product price(s)`}
          </div>
          {overrides && overrides.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <thead className="border-y border-border-subtle bg-bg-base/40 text-xs uppercase tracking-widest text-text-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Product</th>
                  <th className="px-4 py-2.5 text-right font-medium">Retail</th>
                  <th className="px-4 py-2.5 text-right font-medium">Custom</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.product_id} className="border-t border-border-subtle">
                    <td className="px-4 py-3 text-text-primary">
                      {o.product_name}
                      {o.product_sku && <span className="ml-2 text-xs text-text-muted">{o.product_sku}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted line-through">{rp(o.retail_price)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">{rp(o.custom_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
