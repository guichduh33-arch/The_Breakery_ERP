// apps/backoffice/src/features/inventory/components/DirectPurchaseForm.tsx
//
// Accounted "direct purchase" form on the Incoming Stock page. Replaces the old
// free-form receipt: a purchase entered here is routed through the Purchasing
// money-path (useRecordDirectPurchase) so it integrates with stock, WAC, the
// stock analytics AND the accounting ledger (Inventory / Payable / Cash|Bank).
//
// Fields: product (searchable, raw materials only) · purchase unit · quantity ·
// price/unit · computed total · supplier (required) · purchase date · payment
// method (cash/transfer/unpaid) · amount · payment date.
//
// ADR-027 — le sélecteur « Receive into » a disparu : le stock est global, une
// réception ne demande plus aucun choix d'emplacement.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type JSX } from 'react';
import { Button, Input, Select } from '@breakery/ui';
import { formatCurrency, formatQuantity } from '@breakery/utils';
import { toLocalDateStr } from '@breakery/domain';
import { listboxOptionState, useListboxKeyboard } from '@/hooks/useListboxKeyboard.js';
import { useAllProductsForPO, type PoProductRow } from '@/features/purchasing/hooks/useAllProductsForPO.js';
import { useInventoryReferenceData } from '../hooks/useInventoryReferenceData.js';
import {
  useRecordDirectPurchase,
  DirectPurchaseError,
  type DirectPurchasePaymentMethod,
} from '../hooks/useRecordDirectPurchase.js';

type PayChoice = 'cash' | 'transfer' | 'unpaid';

export interface DirectPurchaseFormProps {
  onSuccess?: () => void;
}

export default function DirectPurchaseForm({ onSuccess }: DirectPurchaseFormProps): JSX.Element {
  const products = useAllProductsForPO();
  const refData  = useInventoryReferenceData();
  const purchase = useRecordDirectPurchase();

  const rid = useId();

  const [query,        setQuery       ] = useState<string>('');
  const [pickerOpen,   setPickerOpen  ] = useState<boolean>(false);
  const [product,      setProduct     ] = useState<PoProductRow | null>(null);
  const [unit,         setUnit        ] = useState<string>('');
  const [qty,          setQty         ] = useState<string>('');
  const [price,        setPrice       ] = useState<string>('');
  const [supplierId,   setSupplierId  ] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState<string>(() => toLocalDateStr(new Date()));
  const [pay,          setPay         ] = useState<PayChoice>('cash');
  const [payAmount,    setPayAmount   ] = useState<string>('');
  const [payDate,      setPayDate     ] = useState<string>(() => toLocalDateStr(new Date()));
  const [formError,    setFormError   ] = useState<string | null>(null);
  const [successMsg,   setSuccessMsg  ] = useState<string | null>(null);
  const [idemKey,      setIdemKey     ] = useState<string>(() => crypto.randomUUID());
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (successTimer.current !== null) clearTimeout(successTimer.current); }, []);

  const numQty   = Number.parseFloat(qty);
  const numPrice = Number.parseFloat(price);
  const isQtyValid   = Number.isFinite(numQty) && numQty > 0;
  const isPriceValid = Number.isFinite(numPrice) && numPrice >= 0;
  const factor = useMemo(
    () => product?.unitOptions.find((u) => u.code === unit)?.factor ?? 1,
    [product, unit],
  );
  const total = isQtyValid && isPriceValid ? numQty * numPrice : 0;
  const baseQty = isQtyValid ? numQty * factor : 0;

  const numPayAmount = pay === 'unpaid' ? 0 : Number.parseFloat(payAmount);
  const isPayValid =
    pay === 'unpaid' ||
    (Number.isFinite(numPayAmount) && numPayAmount > 0 && numPayAmount <= total + 0.001);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = products.data ?? [];
    if (term === '') return list.slice(0, 30);
    return list.filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)).slice(0, 30);
  }, [products.data, query]);

  const canSubmit =
    product !== null &&
    unit !== '' &&
    isQtyValid &&
    isPriceValid &&
    supplierId !== '' &&
    purchaseDate !== '' &&
    isPayValid &&
    !purchase.isPending;

  function selectProduct(p: PoProductRow): void {
    setProduct(p);
    setQuery(p.name);
    setPickerOpen(false);
    setUnit(p.defaultPurchaseUnit !== '' ? p.defaultPurchaseUnit : p.unit);
    if (price === '' && p.cost_price !== null && p.cost_price > 0) setPrice(String(p.cost_price));
  }

  function resetForm(): void {
    setProduct(null);
    setQuery('');
    setUnit('');
    setQty('');
    setPrice('');
    setPayAmount('');
    setFormError(null);
    setIdemKey(crypto.randomUUID());
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || product === null) return;
    setFormError(null);
    const method: DirectPurchasePaymentMethod | null = pay === 'unpaid' ? null : pay;
    try {
      const res = await purchase.mutateAsync({
        supplierId,
        productId:        product.id,
        quantity:         numQty,
        unit,
        unitFactorToBase: factor,
        pricePerUnit:     numPrice,
        purchaseDate,
        paymentMethod:    method,
        paymentAmount:    pay === 'unpaid' ? 0 : numPayAmount,
        paymentDate:      payDate,
        idempotencyKey:   idemKey,
      });
      resetForm();
      setSuccessMsg(`Purchase ${res.poNumber} recorded (${res.grnNumber}). Stock + accounting updated.`);
      if (successTimer.current !== null) clearTimeout(successTimer.current);
      successTimer.current = setTimeout(() => setSuccessMsg(null), 5000);
      onSuccess?.();
    } catch (err) {
      if (err instanceof DirectPurchaseError) {
        const hint =
          err.message.includes('product_not_raw_material') ? 'This product is not a purchasable raw material.'
          : err.message.includes('permission') || err.message.includes('forbidden') ? 'You lack the purchasing permission for this action.'
          : err.message.includes('supplier') ? 'Supplier is invalid or inactive.'
          : err.message;
        setFormError(`Failed at ${err.step}: ${hint}`);
      } else {
        setFormError('Something went wrong. Please retry.');
      }
    }
  }

  const suppliers = refData.data?.suppliers ?? [];
  const fieldCls = 'h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary';

  const listOpen = pickerOpen && filtered.length > 0;
  const keyboard = useListboxKeyboard<PoProductRow>({
    items:      filtered,
    open:       listOpen,
    getItemKey: (p) => p.id,
    onSelect:   selectProduct,
    onClose:    () => { setPickerOpen(false); },
  });

  // La fermeture différée survivait au démontage.
  const pickerBlurTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (pickerBlurTimer.current !== null) window.clearTimeout(pickerBlurTimer.current);
  }, []);

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      noValidate
      className="max-w-2xl space-y-4 rounded-lg border border-border-subtle bg-bg-elevated p-6"
    >
      {formError !== null && (
        <div role="alert" className="rounded-md border border-red bg-red-soft p-2 text-xs text-red">{formError}</div>
      )}
      {successMsg !== null && (
        <div role="status" className="rounded-md border border-success bg-success-soft p-2 text-xs text-success">{successMsg}</div>
      )}

      {/* Product (searchable, raw materials only) */}
      <div className="relative space-y-1">
        <label htmlFor={`${rid}-product`} className="text-xs uppercase tracking-widest text-text-secondary">Product</label>
        <input
          id={`${rid}-product`}
          type="text"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={keyboard.listboxId}
          aria-autocomplete="list"
          aria-activedescendant={keyboard.activeDescendantId}
          autoComplete="off"
          placeholder="Search a raw material…"
          value={query}
          onKeyDown={keyboard.handleKeyDown}
          onChange={(e) => { setQuery(e.target.value); setPickerOpen(true); if (product !== null) setProduct(null); }}
          onFocus={() => setPickerOpen(true)}
          onBlur={() => { pickerBlurTimer.current = window.setTimeout(() => { setPickerOpen(false); }, 150); }}
          className={fieldCls}
          disabled={purchase.isPending || products.isLoading}
        />
        {/* Le descendant actif ne déplace pas le focus : sans annonce, l'apparition
            des résultats est muette pour un lecteur d'écran. */}
        <span className="sr-only" role="status" aria-live="polite">{keyboard.statusText}</span>
        {listOpen && (
          <ul id={keyboard.listboxId} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-border-subtle bg-bg-elevated shadow-lg">
            {filtered.map((p, i) => (
              // Non focalisable : surbrillance portée par le champ via
              // `aria-activedescendant` (voir useListboxKeyboard).
              <li
                key={p.id}
                role="option"
                id={keyboard.optionId(i)}
                aria-selected={keyboard.activeIndex === i}
                onMouseEnter={() => { keyboard.onOptionHover(i); }}
                onMouseDown={(e) => { e.preventDefault(); selectProduct(p); }}
                className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm ${listboxOptionState(keyboard.activeIndex === i)}`}
              >
                <span className="min-w-0 truncate text-text-primary">{p.name}</span>
                <span className="shrink-0 font-mono text-xs text-text-muted">{p.sku}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quantity · unit · price/unit */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={`${rid}-qty`} className="text-xs uppercase tracking-widest text-text-secondary">Quantity</label>
          <Input id={`${rid}-qty`} type="number" inputMode="decimal" min={0.001} step="0.001"
            value={qty} onChange={(e) => setQty(e.target.value)} disabled={purchase.isPending} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${rid}-unit`} className="text-xs uppercase tracking-widest text-text-secondary">Purchase unit</label>
          <Select id={`${rid}-unit`} value={unit} onChange={(e) => setUnit(e.target.value)}
            className="w-full" disabled={purchase.isPending || product === null}>
            {product === null ? <option value="">—</option> : product.unitOptions.map((u) => (
              <option key={u.code} value={u.code}>{u.code}{u.factor !== 1 ? ` (×${u.factor} ${product.unit})` : ''}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${rid}-price`} className="text-xs uppercase tracking-widest text-text-secondary">Price / unit</label>
          <Input id={`${rid}-price`} type="number" inputMode="decimal" min={0} step="0.01"
            value={price} onChange={(e) => setPrice(e.target.value)} disabled={purchase.isPending} />
        </div>
      </div>

      {/* Computed total + base-unit conversion */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface-inert px-3 py-2 text-sm">
        <span className="text-text-secondary">
          {isQtyValid && product !== null ? <>= <span className="font-mono text-text-primary">{formatQuantity(baseQty, product.unit)}</span> in base unit</> : 'Enter quantity & price'}
        </span>
        <span className="font-semibold text-text-primary">Total: <span className="font-mono">{formatCurrency(total)}</span></span>
      </div>

      {/* Supplier (required) */}
      <div className="space-y-1 sm:max-w-sm">
        <label htmlFor={`${rid}-supplier`} className="text-xs uppercase tracking-widest text-text-secondary">Supplier</label>
        <Select id={`${rid}-supplier`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
          className="w-full" disabled={refData.isLoading || purchase.isPending}>
          <option value="">Select a supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
        </Select>
      </div>

      {/* Purchase date */}
      <div className="space-y-1 sm:max-w-[12rem]">
        <label htmlFor={`${rid}-date`} className="text-xs uppercase tracking-widest text-text-secondary">Purchase date</label>
        <Input id={`${rid}-date`} type="date" lang="id-ID" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} disabled={purchase.isPending} />
      </div>

      {/* Payment block */}
      <fieldset className="space-y-3 rounded-md border border-border-subtle p-3">
        <legend className="px-1 text-xs uppercase tracking-widest text-text-secondary">Payment</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(['cash', 'transfer', 'unpaid'] as PayChoice[]).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name={`${rid}-pay`} value={m} checked={pay === m}
                onChange={() => { setPay(m); if (m !== 'unpaid' && payAmount === '' && total > 0) setPayAmount(String(total)); }}
                disabled={purchase.isPending} className="accent-gold" />
              <span className="capitalize text-text-primary">{m === 'unpaid' ? 'Unpaid (credit)' : m}</span>
            </label>
          ))}
        </div>
        {pay !== 'unpaid' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${rid}-pay-amount`} className="text-xs uppercase tracking-widest text-text-secondary">Amount paid</label>
              <Input id={`${rid}-pay-amount`} type="number" inputMode="decimal" min={0} step="0.01"
                value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={String(total || '')}
                disabled={purchase.isPending} aria-invalid={payAmount !== '' && !isPayValid} />
              {payAmount !== '' && !isPayValid && (
                <p className="text-xs text-red">Amount must be &gt; 0 and ≤ total.</p>
              )}
            </div>
            <div className="space-y-1">
              <label htmlFor={`${rid}-pay-date`} className="text-xs uppercase tracking-widest text-text-secondary">Payment date</label>
              <Input id={`${rid}-pay-date`} type="date" lang="id-ID" value={payDate} onChange={(e) => setPayDate(e.target.value)} disabled={purchase.isPending} />
            </div>
          </div>
        )}
      </fieldset>

      <div className="flex justify-end pt-2">
        <Button type="submit" variant="ink" disabled={!canSubmit}>
          {purchase.isPending ? 'Recording…' : 'Record purchase'}
        </Button>
      </div>
    </form>
  );
}
