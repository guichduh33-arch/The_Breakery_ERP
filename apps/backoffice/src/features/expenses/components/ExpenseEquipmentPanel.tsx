// apps/backoffice/src/features/expenses/components/ExpenseEquipmentPanel.tsx
//
// ADR-047 — marque « équipement » d'une dépense. En brouillon, le créateur (ou
// un porteur de `expenses.manage`) marque ou démarque l'achat ; hors
// brouillon, la marque se lit seulement. À l'approbation, le serveur débite le
// compte d'équipement du type au lieu du compte de la catégorie, et crée les
// fiches du registre (une par article).
//
// Le seuil se juge PAR ARTICLE, TTC (décision 1) : trois tablettes à
// 1 500 000 IDR restent une dépense, même si la facture dépasse 2 000 000.
// L'écran l'annonce avant l'envoi ; le serveur le revérifie au marquage et à
// l'approbation.

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Input, Select } from '@breakery/ui';
import { Button, Card } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { formatCurrency } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import type { ExpenseRow } from '../hooks/useExpensesList.js';
import { expenseEquipmentErrorMessage, useSetExpenseEquipment } from '../hooks/useSetExpenseEquipment.js';
import {
  FIXED_ASSET_TAX_GROUPS,
  FIXED_ASSET_TAX_GROUP_LABEL,
  FIXED_ASSET_THRESHOLD_PER_ITEM,
  FIXED_ASSET_TYPES,
  FIXED_ASSET_TYPE_LABEL,
  type FixedAssetTaxGroup,
  type FixedAssetType,
} from '@/features/accounting/components/fixedAssetContract.js';

type EquipmentExpense = Pick<ExpenseRow,
  'id' | 'status' | 'amount' | 'created_by' | 'asset_type' | 'asset_tax_group' | 'asset_name' | 'asset_quantity'>;

const LABEL = 'block space-y-1 text-sm font-medium';

export function ExpenseEquipmentPanel({ expense }: { expense: EquipmentExpense }): JSX.Element | null {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const m = useSetExpenseEquipment();

  const marked = expense.asset_type !== null;
  const isDraft = expense.status === 'draft';
  // Même règle que le serveur : brouillon, et créateur ou `expenses.manage`.
  const canEdit = isDraft && (hasPermission('expenses.manage')
    || (hasPermission('expenses.create') && currentUserId !== null && expense.created_by === currentUserId));

  const [editing, setEditing] = useState(false);
  const [assetType, setAssetType] = useState<FixedAssetType | ''>(expense.asset_type ?? '');
  const [taxGroup, setTaxGroup] = useState<FixedAssetTaxGroup | ''>(expense.asset_tax_group ?? '');
  const [name, setName] = useState(expense.asset_name ?? '');
  const [quantity, setQuantity] = useState(String(expense.asset_quantity ?? 1));

  // Rien à dire d'une dépense ordinaire qu'on ne peut plus marquer.
  if (!marked && !canEdit) return null;

  const amount = Number(expense.amount);
  const qty = Number(quantity);
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= 50;
  const perItem = qtyOk ? amount / qty : null;
  const belowThreshold = qtyOk && amount < FIXED_ASSET_THRESHOLD_PER_ITEM * qty;
  const nameOk = name.trim().length >= 2 && name.trim().length <= 120;
  const canSave = assetType !== '' && taxGroup !== '' && nameOk && qtyOk && !belowThreshold && !m.isPending;

  const startEdit = (): void => {
    setAssetType(expense.asset_type ?? ''); setTaxGroup(expense.asset_tax_group ?? '');
    setName(expense.asset_name ?? ''); setQuantity(String(expense.asset_quantity ?? 1));
    m.reset(); setEditing(true);
  };

  const save = async (): Promise<void> => {
    // `canSave` exige déjà un type et un groupe : TypeScript le sait (garde aliasée).
    if (!canSave) return;
    try {
      await m.mutateAsync({ expenseId: expense.id, assetType, taxGroup, assetName: name, quantity: qty });
      setEditing(false);
    } catch { /* affiché depuis m.error */ }
  };

  const unmark = async (): Promise<void> => {
    try {
      await m.mutateAsync({ expenseId: expense.id, assetType: null });
      setEditing(false);
    } catch { /* affiché depuis m.error */ }
  };

  const debited = expense.status === 'approved' || expense.status === 'paid';

  return (
    <Card variant="default" padding="md" className="space-y-3" data-testid="expense-equipment-panel">
      <SectionLabel as="h2" size="sm" className="text-gold">Equipment</SectionLabel>

      {!editing && marked && (
        <dl className="space-y-1.5 text-sm" data-testid="expense-equipment-summary">
          <div className="flex justify-between gap-2"><dt className="text-text-secondary">Name</dt><dd className="text-text-primary">{expense.asset_name}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-text-secondary">Type</dt><dd className="text-text-primary">{expense.asset_type !== null ? FIXED_ASSET_TYPE_LABEL[expense.asset_type] : '—'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-text-secondary">Tax group</dt><dd className="text-text-primary">{expense.asset_tax_group !== null ? FIXED_ASSET_TAX_GROUP_LABEL[expense.asset_tax_group] : '—'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-text-secondary">Quantity</dt><dd className="font-data tabular-nums text-text-primary">{expense.asset_quantity}</dd></div>
        </dl>
      )}

      {!editing && marked && (
        <p className="text-xs text-text-secondary" data-testid="expense-equipment-consequence">
          {debited
            ? 'Approved: the debit went to the equipment account of this type, not to the category account. Each item has a card in the fixed asset register.'
            : 'On approval, the debit goes to the equipment account of this type instead of the category account, and each item gets a card in the fixed asset register.'}
          {debited && hasPermission('reports.statements.read') && (
            <>
              {' '}
              <Link to="/backoffice/accounting/fixed-assets" className={`text-gold hover:underline ${FOCUS_RING}`}>
                Open the register
              </Link>
            </>
          )}
        </p>
      )}

      {!editing && !marked && canEdit && (
        <p className="text-sm text-text-secondary">
          Mark this purchase as equipment when each item costs at least 2,000,000 IDR, incl. VAT. It is
          then depreciated instead of expensed.
        </p>
      )}

      {editing && (
        <div className="space-y-3">
          <label className={LABEL}>
            Equipment name
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="expense-equipment-name" />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Type
              <Select value={assetType} onChange={(e) => setAssetType(e.target.value as FixedAssetType | '')} data-testid="expense-equipment-type">
                <option value="">Choose a type</option>
                {FIXED_ASSET_TYPES.map((t) => <option key={t} value={t}>{FIXED_ASSET_TYPE_LABEL[t]}</option>)}
              </Select>
            </label>
            <label className={LABEL}>
              Tax group
              <Select value={taxGroup} onChange={(e) => setTaxGroup(e.target.value as FixedAssetTaxGroup | '')} data-testid="expense-equipment-group">
                <option value="">Choose a group</option>
                {FIXED_ASSET_TAX_GROUPS.map((g) => <option key={g} value={g}>{FIXED_ASSET_TAX_GROUP_LABEL[g]}</option>)}
              </Select>
            </label>
          </div>
          <label className={LABEL}>
            Quantity (identical items)
            <Input type="number" min="1" max="50" step="1" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="font-mono" data-testid="expense-equipment-quantity" />
          </label>
          <p className={`text-xs ${belowThreshold ? 'text-danger-as-text' : 'text-text-muted'}`} data-testid="expense-equipment-threshold">
            2,000,000 IDR per item, incl. VAT.
            {perItem !== null && <> Per item: <span className="font-data tabular-nums">{formatCurrency(perItem)}</span>.</>}
            {belowThreshold && ' Below the threshold: keep it as an ordinary expense.'}
          </p>
        </div>
      )}

      {m.error && (
        <p role="alert" className="text-sm text-danger-as-text" data-testid="expense-equipment-error">
          {expenseEquipmentErrorMessage(m.error)}
        </p>
      )}

      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          {editing ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => { setEditing(false); m.reset(); }}>Cancel</Button>
              <Button type="button" variant="ink" size="sm" disabled={!canSave} onClick={() => { void save(); }} data-testid="expense-equipment-save">
                {m.isPending ? 'Saving…' : 'Save equipment'}
              </Button>
            </>
          ) : (
            <>
              {marked && (
                <Button type="button" variant="secondary" size="sm" disabled={m.isPending} onClick={() => { void unmark(); }} data-testid="expense-equipment-unmark">
                  Remove equipment mark
                </Button>
              )}
              <Button type="button" variant="secondary" size="sm" onClick={startEdit} data-testid="expense-equipment-edit">
                {marked ? 'Edit' : 'Mark as equipment'}
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
