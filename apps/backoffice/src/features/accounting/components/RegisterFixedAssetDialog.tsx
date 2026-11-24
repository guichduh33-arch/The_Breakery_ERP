// apps/backoffice/src/features/accounting/components/RegisterFixedAssetDialog.tsx
//
// ADR-047 — inscrire au registre un équipement acheté avant lui, avec ses
// amortissements cumulés à une fin de mois (register_existing_fixed_asset_v1).
// Aucune écriture d'achat : l'équipement est déjà au bilan. La dotation
// automatique repart du mois qui suit la date du cumul.
//
// Idempotence : la clé naît à l'ouverture et ne change qu'après un succès ;
// un nouvel essai après une coupure rejoue la même inscription.

import { useRef, useState, type JSX } from 'react';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { formatCurrency, todayIsoDate } from '@breakery/utils';
import {
  FIXED_ASSET_TAX_GROUPS,
  FIXED_ASSET_TAX_GROUP_LABEL,
  FIXED_ASSET_TYPES,
  FIXED_ASSET_TYPE_LABEL,
  isMonthEnd,
  parseIdrAmount as amountOf,
  type FixedAssetTaxGroup,
  type FixedAssetType,
} from './fixedAssetContract.js';
import { fixedAssetErrorMessage, useRegisterExistingFixedAsset } from '../hooks/useFixedAssets.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

const LABEL = 'block space-y-1 text-sm font-medium';

export function RegisterFixedAssetDialog({ open, onClose }: Props): JSX.Element {
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState<FixedAssetType | ''>('');
  const [taxGroup, setTaxGroup] = useState<FixedAssetTaxGroup | ''>('');
  const [inService, setInService] = useState('');
  const [cost, setCost] = useState('');
  const [accumulated, setAccumulated] = useState('');
  const [asOf, setAsOf] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const idem = useRef(crypto.randomUUID());
  const m = useRegisterExistingFixedAsset();

  const reset = (): void => {
    setName(''); setAssetType(''); setTaxGroup(''); setInService('');
    setCost(''); setAccumulated(''); setAsOf(''); setLocalError(null);
    m.reset();
  };
  const handleClose = (): void => { reset(); onClose(); };

  const costValue = amountOf(cost);
  const accumulatedValue = amountOf(accumulated);
  const netPreview = costValue !== null && accumulatedValue !== null ? costValue - accumulatedValue : null;

  const handleSubmit = async (): Promise<void> => {
    setLocalError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 120) { setLocalError('The name must be 2 to 120 characters.'); return; }
    if (assetType === '' || taxGroup === '') { setLocalError('Pick a type and a tax group.'); return; }
    if (inService === '') { setLocalError('Enter the in-service date.'); return; }
    if (costValue === null || costValue <= 0) { setLocalError('Enter a cost above zero, with at most two decimals.'); return; }
    if (accumulatedValue === null || accumulatedValue > costValue) {
      setLocalError('Accumulated depreciation must be between zero and the cost.'); return;
    }
    if (!isMonthEnd(asOf)) { setLocalError('The accumulated depreciation date must be the last day of a month.'); return; }
    if (inService > asOf) { setLocalError('The in-service date must be on or before the accumulated depreciation date.'); return; }
    if (asOf > todayIsoDate()) { setLocalError('The accumulated depreciation date cannot be in the future.'); return; }
    try {
      await m.mutateAsync({
        name: trimmed, assetType, taxGroup, inServiceDate: inService, cost: costValue,
        accumulated: accumulatedValue, accumulatedAsOf: asOf, idempotencyKey: idem.current,
      });
      // Succès seulement : la prochaine inscription est une demande neuve.
      idem.current = crypto.randomUUID();
      handleClose();
    } catch {
      // Le refus est affiché depuis m.error ; la clé reste celle de la demande.
    }
  };

  const error = localError ?? (m.error ? fixedAssetErrorMessage(m.error) : null);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Register existing asset</DialogTitle>
        <DialogDescription>
          For equipment already on the balance sheet. No purchase entry is posted. Automatic
          depreciation starts the month after the accumulated depreciation date.
        </DialogDescription>

        <div className="space-y-3">
          <label className={LABEL}>
            Name
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="fa-register-name" />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Type
              <Select value={assetType} onChange={(e) => setAssetType(e.target.value as FixedAssetType | '')} data-testid="fa-register-type">
                <option value="">Choose a type</option>
                {FIXED_ASSET_TYPES.map((t) => <option key={t} value={t}>{FIXED_ASSET_TYPE_LABEL[t]}</option>)}
              </Select>
            </label>
            <label className={LABEL}>
              Tax group
              <Select value={taxGroup} onChange={(e) => setTaxGroup(e.target.value as FixedAssetTaxGroup | '')} data-testid="fa-register-group">
                <option value="">Choose a group</option>
                {FIXED_ASSET_TAX_GROUPS.map((g) => <option key={g} value={g}>{FIXED_ASSET_TAX_GROUP_LABEL[g]}</option>)}
              </Select>
            </label>
            <label className={LABEL}>
              In-service date
              <Input type="date" lang="id-ID" value={inService} max={todayIsoDate()} onChange={(e) => setInService(e.target.value)} data-testid="fa-register-in-service" />
            </label>
            <label className={LABEL}>
              Cost (IDR, incl. VAT)
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className="font-mono" data-testid="fa-register-cost" />
            </label>
            <label className={LABEL}>
              Accumulated depreciation (IDR)
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={accumulated} onChange={(e) => setAccumulated(e.target.value)} className="font-mono" data-testid="fa-register-accumulated" />
            </label>
            <label className={LABEL}>
              Accumulated as of (month end)
              <Input type="date" lang="id-ID" value={asOf} max={todayIsoDate()} onChange={(e) => setAsOf(e.target.value)} data-testid="fa-register-as-of" />
            </label>
          </div>
          {netPreview !== null && netPreview >= 0 && (
            <p className="text-sm text-text-secondary" data-testid="fa-register-net">
              Net book value at that date:{' '}
              <span className="font-data tabular-nums text-text-primary">{formatCurrency(netPreview)}</span>
            </p>
          )}
        </div>

        {error !== null && (
          <p role="alert" className="text-sm text-danger-as-text" data-testid="fa-register-error">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleClose}>Cancel</Button>
          <Button type="button" variant="ink" size="sm" onClick={() => { void handleSubmit(); }} disabled={m.isPending} data-testid="fa-register-submit">
            {m.isPending ? 'Registering…' : 'Register asset'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
