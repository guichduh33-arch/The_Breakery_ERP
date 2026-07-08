// apps/backoffice/src/features/customers/components/CategoryFormModal.tsx
//
// S69 Volet A (Task 3) — Create/Edit modal for customer_categories.
// Mirrors apps/backoffice/src/features/categories/components/CategoryFormDialog.tsx
// (native <select>, controlled inputs, inline error banner) and
// apps/backoffice/src/features/lan-devices/components/LanDeviceFormModal.tsx
// (Dialog + effect-driven prefill on `open`).

import { useEffect, useState, type JSX } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Select,
} from '@breakery/ui';
import type { PriceModifierType } from '@breakery/domain';
import type { CategoryInput } from '../hooks/useCustomerCategoryMutations.js';
import type { CustomerCategoryRow } from '../hooks/useCustomerCategories.js';

const PRICE_MODIFIER_TYPES: readonly { value: PriceModifierType; label: string }[] = [
  { value: 'retail',             label: 'Retail (standard price)' },
  { value: 'wholesale',          label: 'Wholesale price' },
  { value: 'discount_percentage', label: 'Discount %' },
  { value: 'custom',             label: 'Custom price' },
];

export interface CategoryFormModalProps {
  open:       boolean;
  onClose:    () => void;
  initial?:   CustomerCategoryRow | undefined;
  onSubmit:   (input: CategoryInput) => void;
  pending:    boolean;
  errorText:  string | null;
}

const labelCls = 'block text-xs uppercase tracking-wider text-text-secondary mb-1';

export function CategoryFormModal({
  open, onClose, initial, onSubmit, pending, errorText,
}: CategoryFormModalProps): JSX.Element {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [priceModifierType, setPriceModifierType] = useState<PriceModifierType>('retail');
  const [discountPercentage, setDiscountPercentage] = useState('0');
  const [pointsMultiplier, setPointsMultiplier] = useState('1');
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [color, setColor] = useState('');
  const [icon, setIcon] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    setName(initial?.name ?? '');
    setSlug(initial?.slug ?? '');
    setPriceModifierType(initial?.price_modifier_type ?? 'retail');
    setDiscountPercentage(String(initial?.discount_percentage ?? 0));
    setPointsMultiplier(String(initial?.points_multiplier ?? 1));
    setLoyaltyEnabled(initial?.loyalty_enabled ?? true);
    setIsDefault(initial?.is_default ?? false);
    setColor(initial?.color ?? '');
    setIcon(initial?.icon ?? '');
  }, [open, initial]);

  function handleSubmit(): void {
    if (name.trim() === '') {
      setLocalError('Name is required.');
      return;
    }
    if (slug.trim() === '') {
      setLocalError('Slug is required.');
      return;
    }
    const discount = Number(discountPercentage);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      setLocalError('Discount must be between 0 and 100.');
      return;
    }
    const multiplier = Number(pointsMultiplier);
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      setLocalError('Points multiplier must be ≥ 0.');
      return;
    }
    setLocalError(null);
    onSubmit({
      name: name.trim(),
      slug: slug.trim(),
      price_modifier_type: priceModifierType,
      discount_percentage: discount,
      points_multiplier: multiplier,
      loyalty_enabled: loyaltyEnabled,
      color: color.trim() === '' ? null : color.trim(),
      icon: icon.trim() === '' ? null : icon.trim(),
      is_default: isDefault,
    });
  }

  const shownError = errorText ?? localError;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="category-form-modal">
        <DialogHeader>
          <DialogTitle>{initial !== undefined ? 'Edit category' : 'New category'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="cc-name" className={labelCls}>Name</label>
            <Input
              id="cc-name" aria-label="Name"
              value={name} onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>

          <div>
            <label htmlFor="cc-slug" className={labelCls}>Slug</label>
            <Input
              id="cc-slug" aria-label="Slug"
              value={slug} onChange={(e) => setSlug(e.target.value)}
              className="font-mono" placeholder="wholesale" maxLength={120}
            />
          </div>

          <div>
            <label htmlFor="cc-price-type" className={labelCls}>Pricing type</label>
            <Select
              id="cc-price-type" aria-label="Pricing type" className="w-full"
              value={priceModifierType}
              onChange={(e) => setPriceModifierType(e.target.value as PriceModifierType)}
            >
              {PRICE_MODIFIER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </div>

          {priceModifierType === 'discount_percentage' && (
            <div>
              <label htmlFor="cc-discount" className={labelCls}>Discount %</label>
              <Input
                id="cc-discount" aria-label="Discount %" inputMode="decimal"
                value={discountPercentage} onChange={(e) => setDiscountPercentage(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor="cc-multiplier" className={labelCls}>Points multiplier</label>
            <Input
              id="cc-multiplier" aria-label="Points multiplier" inputMode="decimal"
              value={pointsMultiplier} onChange={(e) => setPointsMultiplier(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="cc-color" className={labelCls}>Color (optional)</label>
              <Input
                id="cc-color" aria-label="Color" placeholder="bg-cat-blue"
                value={color} onChange={(e) => setColor(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="cc-icon" className={labelCls}>Icon (optional)</label>
              <Input
                id="cc-icon" aria-label="Icon" placeholder="crown"
                value={icon} onChange={(e) => setIcon(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox" checked={loyaltyEnabled}
              onChange={(e) => setLoyaltyEnabled(e.target.checked)}
            />
            Loyalty enabled
          </label>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox" checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Default category
          </label>

          {shownError !== null && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
              {shownError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending} data-testid="category-form-submit">
            {pending
              ? (initial !== undefined ? 'Saving…' : 'Creating…')
              : (initial !== undefined ? 'Save' : 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
