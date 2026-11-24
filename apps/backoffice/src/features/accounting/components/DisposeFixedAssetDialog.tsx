// apps/backoffice/src/features/accounting/components/DisposeFixedAssetDialog.tsx
//
// ADR-047 décision 8 — sortie d'un équipement : vente, casse ou mise au rebut
// (dispose_fixed_asset_v1). La sortie exige un PIN manager vérifié serveur,
// avec verrouillage. Le serveur poste d'abord les dotations des mois terminés
// avant le mois de sortie, puis solde coût et cumul : l'aperçu du gain ou de
// la perte affiché ici part de la valeur nette ACTUELLE, il est indicatif.
//
// Compte qui reçoit le prix d'une vente : trésorerie seulement (classe 1,
// hors tableau de flux, actif, postable) — le même filtre que le serveur.

import { useMemo, useState, type JSX } from 'react';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { formatCurrency, todayIsoDate } from '@breakery/utils';
import { useChartOfAccounts } from '../hooks/useChartOfAccounts.js';
import { fixedAssetErrorMessage, useDisposeFixedAsset } from '../hooks/useFixedAssets.js';
import {
  FIXED_ASSET_DISPOSAL_REASONS,
  FIXED_ASSET_DISPOSAL_REASON_LABEL,
  parseIdrAmount,
  type FixedAssetDisposalReason,
  type FixedAssetRow,
} from './fixedAssetContract.js';

interface Props {
  open: boolean;
  onClose: () => void;
  asset: Pick<FixedAssetRow, 'id' | 'asset_number' | 'name' | 'net_book_value' | 'in_service_date'>;
}

const LABEL = 'block space-y-1 text-sm font-medium';

export function DisposeFixedAssetDialog({ open, onClose, asset }: Props): JSX.Element {
  const today = todayIsoDate();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState<FixedAssetDisposalReason | ''>('');
  const [price, setPrice] = useState('');
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const m = useDisposeFixedAsset();
  const accounts = useChartOfAccounts();

  const isSale = reason === 'sale';
  const treasury = useMemo(
    () => (accounts.data ?? []).filter((a) => a.account_class === 1 && a.cash_flow_section === 'none'
      && a.is_active && a.is_postable),
    [accounts.data],
  );
  const priceValue = isSale ? parseIdrAmount(price) : 0;
  const preview = priceValue === null ? null : priceValue - asset.net_book_value;
  const pinOk = /^\d{6}$/.test(pin);

  const reset = (): void => {
    setDate(todayIsoDate()); setReason(''); setPrice(''); setAccountId('');
    setNotes(''); setPin(''); setLocalError(null); m.reset();
  };
  const handleClose = (): void => { reset(); onClose(); };

  const handleSubmit = async (): Promise<void> => {
    setLocalError(null);
    if (reason === '') { setLocalError('Pick a disposal reason.'); return; }
    if (date === '' || date > today || date < asset.in_service_date) {
      setLocalError('The disposal date must be between the in-service date and today.'); return;
    }
    if (isSale && (priceValue === null || priceValue <= 0)) {
      setLocalError('Enter a sale price above zero, with at most two decimals.'); return;
    }
    if (isSale && accountId === '') { setLocalError('Pick the account that receives the money.'); return; }
    if (notes.trim().length > 500) { setLocalError('Notes are limited to 500 characters.'); return; }
    if (!pinOk) { setLocalError('PIN must be exactly 6 digits.'); return; }
    try {
      await m.mutateAsync({
        assetId: asset.id, disposalDate: date, reason,
        salePrice: isSale ? priceValue : null, proceedsAccountId: isSale ? accountId : null,
        notes, managerPin: pin,
      });
      handleClose();
    } catch {
      // Un PIN faux se ressaisit : seul le PIN est vidé.
      setPin('');
    }
  };

  const error = localError ?? (m.error ? fixedAssetErrorMessage(m.error) : null);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Dispose of {asset.asset_number}</DialogTitle>
        <DialogDescription>
          {asset.name}. The asset leaves the accounts with its accumulated depreciation. This
          cannot be undone.
        </DialogDescription>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Disposal date
              <Input type="date" lang="id-ID" value={date} min={asset.in_service_date} max={today} onChange={(e) => setDate(e.target.value)} data-testid="fa-dispose-date" />
            </label>
            <label className={LABEL}>
              Reason
              <Select
                value={reason}
                onChange={(e) => { setReason(e.target.value as FixedAssetDisposalReason | ''); setLocalError(null); }}
                data-testid="fa-dispose-reason"
              >
                <option value="">Choose a reason</option>
                {FIXED_ASSET_DISPOSAL_REASONS.map((r) => (
                  <option key={r} value={r}>{FIXED_ASSET_DISPOSAL_REASON_LABEL[r]}</option>
                ))}
              </Select>
            </label>
            {isSale && (
              <>
                <label className={LABEL}>
                  Sale price (IDR)
                  <Input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="font-mono" data-testid="fa-dispose-price" />
                </label>
                <label className={LABEL}>
                  Received in
                  <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="fa-dispose-account">
                    <option value="">Choose a cash or bank account</option>
                    {treasury.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </Select>
                </label>
              </>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-border-subtle bg-surface-inert p-3 text-sm" data-testid="fa-dispose-preview">
            <dt className="text-text-secondary">Net book value today</dt>
            <dd className="text-right font-data tabular-nums text-text-primary">{formatCurrency(asset.net_book_value)}</dd>
            <dt className="text-text-secondary">{preview !== null && preview >= 0 ? 'Gain (indicative)' : 'Loss (indicative)'}</dt>
            <dd className="text-right font-data tabular-nums text-text-primary" data-testid="fa-dispose-result">
              {preview === null ? '—' : formatCurrency(Math.abs(preview))}
            </dd>
            <dd className="col-span-2 text-xs text-text-muted">
              The server first posts any depreciation due before the disposal month, then computes the
              final result.
            </dd>
          </dl>

          <div>
            <label htmlFor="fa-dispose-notes" className="block text-sm font-medium">Notes (optional)</label>
            <textarea
              id="fa-dispose-notes"
              value={notes}
              maxLength={500}
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
              className={`mt-1 w-full rounded border border-border-strong p-2 text-sm placeholder:text-text-muted ${FOCUS_RING}`}
              data-testid="fa-dispose-notes"
            />
          </div>

          <div>
            <label htmlFor="fa-dispose-pin" className="block text-sm font-medium">Manager PIN</label>
            <input
              id="fa-dispose-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className={`mt-1 h-touch-min w-full rounded border border-border-strong px-2 text-sm tracking-widest ${FOCUS_RING}`}
              aria-invalid={pin.length > 0 && !pinOk}
              aria-describedby="fa-dispose-pin-hint"
              data-testid="fa-dispose-pin"
            />
            <p id="fa-dispose-pin-hint" className={`mt-1 text-xs ${pin.length > 0 && !pinOk ? 'text-danger' : 'text-text-muted'}`}>
              {pin.length > 0 && !pinOk ? 'Exactly 6 digits' : '6 digits'}
            </p>
          </div>
        </div>

        {error !== null && (
          <p role="alert" className="text-sm text-danger-as-text" data-testid="fa-dispose-error">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleClose}>Cancel</Button>
          <Button type="button" variant="ink" size="sm" onClick={() => { void handleSubmit(); }} disabled={m.isPending} data-testid="fa-dispose-submit">
            {m.isPending ? 'Disposing…' : 'Dispose asset'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
