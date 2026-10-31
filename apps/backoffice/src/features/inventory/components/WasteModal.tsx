// Déclare une perte sans révéler le stock théorique ; seul le propriétaire approuve.
import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { parseStockQuantity } from '../stockQuantity.js';
import { useWasteStock, WasteStockError } from '../hooks/useWasteStock.js';
import { STOCK_LEVELS_QUERY_KEY, type StockLevelRow } from '../hooks/useStockLevels.js';
import type { ProductTypeaheadRow } from '../hooks/useProductsForInventory.js';
import { ProductTypeahead } from './ProductTypeahead.js';

export interface WasteModalProps {
  open:             boolean;
  /** When provided, the typeahead is hidden and the product is locked. */
  initialProduct?:  StockLevelRow;
  onClose:          () => void;
}

type ReasonPreset = 'Expired' | 'Damaged' | 'Spoiled' | 'Other';

const PRESETS: readonly ReasonPreset[] = ['Expired', 'Damaged', 'Spoiled', 'Other'];
const MAX_REASON = 500;

function stockLevelToTypeaheadRow(row: StockLevelRow): ProductTypeaheadRow {
  return { id: row.product_id, sku: row.sku, name: row.name, current_stock: row.current_stock, unit: row.unit };
}

export function WasteModal({ open, initialProduct, onClose }: WasteModalProps): JSX.Element {
  const wasteMut = useWasteStock();
  const qc       = useQueryClient();
  const reactId  = useId();
  const productInputId = `${reactId}-product`;
  const qtyId    = `${reactId}-qty`;
  const qtyErrId = `${reactId}-qty-err`;
  const presetId = `${reactId}-preset`;
  const reasonId = `${reactId}-reason`;
  const reasonHintId = `${reactId}-reason-hint`;

  const [product, setProduct] = useState<ProductTypeaheadRow | null>(
    initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null,
  );
  const [qty, setQty] = useState<string>('');
  const [preset, setPreset] = useState<ReasonPreset>('Expired');
  const [otherReason, setOtherReason] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [attemptLocked, setAttemptLocked] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    if (open) {
      setProduct(initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null);
      setQty('');
      setAttemptLocked(false);
      setPreset('Expired');
      setOtherReason('');
      setFormError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
    // initialProduct object identity changes on every parent render; depending on the primitive product_id
    // is the real signal — adding initialProduct itself would reset the modal on unrelated parent updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProduct?.product_id]);

  const numericQty = parseStockQuantity(qty) ?? Number.NaN;
  const isQtyPositive = Number.isFinite(numericQty) && numericQty > 0;
  const isQtyValid = isQtyPositive && numericQty <= 9999999.999;

  const finalReason = preset === 'Other' ? otherReason.trim() : preset;
  const isReasonValid = finalReason.length >= 3 && finalReason.length <= MAX_REASON;

  const canSubmit = product !== null && isQtyValid && isReasonValid && !wasteMut.isPending;

  function handleClose(): void {
    if (attemptLocked || wasteMut.isPending) return;
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || product === null) return;

    setFormError(null);
    setAttemptLocked(true);
    try {
      const res = await wasteMut.mutateAsync({
        productId:      product.id,
        quantity:       numericQty,
        reason:         finalReason,
        idempotencyKey,
      });
      // La modale se refermait EN SILENCE sur un geste irréversible : rien ne
      // confirmait que la perte était enregistrée, ni ce qu'il restait. Mains
      // occupées, session interrompue, l'utilisateur ressaisissait — et la clé
      // d'idempotence ne l'en protège pas, une réouverture en régénérant une neuve.
      const confirmation = res.status === 'pending'
        ? `Declaration ${res.idempotent_replay ? 'already submitted' : 'submitted'} — ${product.name}. Owner approval is required before stock changes.`
        : `Declaration already ${res.status} — ${product.name}. No new stock operation was recorded.`;
      if (res.idempotent_replay) toast.info(confirmation);
      else toast.success(confirmation);
      setAttemptLocked(false);
      onClose();
    } catch (err) {
      if (err instanceof WasteStockError) {
        if (err.code !== 'unknown' && err.code !== 'idempotency_conflict') setAttemptLocked(false);
        switch (err.code) {
          case 'idempotency_conflict':
            setFormError('This request key belongs to different details. Check movement history before starting another operation.');
            break;
          case 'invalid_quantity':
            setFormError('Enter a valid quantity with up to 3 decimal places.');
            break;
          case 'forbidden':
            setFormError('You no longer have permission to record waste. Please refresh.');
            break;
          case 'quantity_must_be_positive':
            setFormError('Quantity must be greater than zero.');
            break;
          case 'insufficient_stock':
            setFormError('The owner must review stock availability before approval.');
            void qc.invalidateQueries({ queryKey: STOCK_LEVELS_QUERY_KEY });
            break;
          case 'product_not_found':
            setFormError('Product was deleted in another session. Refresh and retry.');
            void qc.invalidateQueries({ queryKey: STOCK_LEVELS_QUERY_KEY });
            break;
          default:
            setFormError('Something went wrong. Please retry.');
        }
      } else {
        setFormError('Something went wrong. Please retry.');
      }
    }
  }

  const isLockedProduct = initialProduct !== undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>
          Record waste {isLockedProduct && initialProduct !== undefined ? `— ${initialProduct.name}` : ''}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Declare shrinkage, expiry, or damage for independent owner approval. Stock stays unchanged until approval.
        </DialogDescription>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
          {formError !== null && (
            <div role="alert" className="rounded-md border border-red bg-red-soft p-2 text-xs text-red-as-text">
              {formError}
            </div>
          )}

          {attemptLocked && !wasteMut.isPending && (
            <p role="status" className="text-sm text-text-secondary">Details are locked. Retry sends the same request; check movement history before starting another operation.</p>
          )}
          <fieldset disabled={attemptLocked || wasteMut.isPending} className="space-y-4">
          {!isLockedProduct && (
            <div className="space-y-1">
              <label htmlFor={productInputId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
                Product
              </label>
              <ProductTypeahead
                id={productInputId}
                value={product}
                onChange={setProduct}
                disabled={wasteMut.isPending}
              />
            </div>
          )}


          <div className="space-y-1">
            <label htmlFor={qtyId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
              Quantity wasted {product?.unit ? `(${product.unit})` : ''}
            </label>
            <Input
              id={qtyId}
              type="number"
              inputMode="decimal"
              min={0}
              max={9999999.999}
              step="0.001"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              aria-invalid={qty !== '' && !isQtyValid}
              aria-describedby={qty !== '' && !isQtyValid ? qtyErrId : undefined}
              disabled={product === null}
            />
            {qty !== '' && !isQtyPositive && (
              <p id={qtyErrId} className="text-red-as-text text-xs">Quantity must be &gt; 0.</p>
            )}
            {qty !== '' && isQtyPositive && !isQtyValid && (
              <p id={qtyErrId} className="text-red-as-text text-xs">
                Quantity exceeds the supported limit.
              </p>
            )}
          </div>

          {/* Aperçu de la CONSÉQUENCE, symétrique de celui de l'ajustement.
              L'écran disait auparavant deux fois le stock actuel — « 40 (max:
              40) » — sans jamais dire ce qu'il resterait après le geste. */}

          <div className="space-y-1">
            <label htmlFor={presetId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
              Reason
            </label>
            <Select
              id={presetId}
              value={preset}
              onChange={(e) => setPreset(e.target.value as ReasonPreset)}
              className="w-full"
            >
              {PRESETS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </div>

          {preset === 'Other' && (
            <div className="space-y-1">
              <label htmlFor={reasonId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
                Describe
              </label>
              <textarea
                id={reasonId}
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                rows={3}
                maxLength={MAX_REASON}
                aria-describedby={reasonHintId}
                className="w-full rounded-md border border-border-strong bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold placeholder:text-text-muted"
                placeholder="At least 3 characters; appears in the audit trail."
              />
              <p id={reasonHintId} className="text-text-secondary text-xs">
                {otherReason.trim().length}/{MAX_REASON}
              </p>
            </div>
          )}

          {/* Le registre est append-only : l'interface ne propose jamais de
              corriger un mouvement, elle propose d'en émettre un autre. Le dire
              AVANT le bouton qui produit l'écriture, pas après — c'est un geste
              comptable nominatif qui touche l'argent. */}
          <p className="rounded-md border border-border-subtle bg-surface-inert p-2 text-xs text-text-secondary">
            Your declaration is recorded in your name. Stock changes only after independent owner approval.
          </p>

          </fieldset>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={attemptLocked || wasteMut.isPending}>Cancel</Button>
            <Button type="submit" variant="ink" disabled={!canSubmit}>
              {wasteMut.isPending ? 'Submitting…' : attemptLocked ? 'Retry declaration' : 'Submit for approval'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
