// apps/backoffice/src/features/accounting/components/RecordCashMovementModal.tsx
// Cash Wallets module — modal to record a manual cash movement (posts a balanced JE).
// Native <select> kept (shared `inputCls` with the hand-styled inputs) so every
// control in this modal stays visually uniform.
//
// Le raisonnement qui suivait — « le primitif Select introduirait un champ isolé
// de 44 px parmi eux » — prenait l'écart pour la norme : DESIGN.md § Champs pose
// 44 px, rayon 4 px, fond feuille blanche et anneau or, et c'est `inputCls` qui
// était hors spécification à ~37 px et sans anneau de focus. Corrigé le
// 2026-08-18 en montant TOUS les contrôles du modal à 44 px : l'uniformité est
// conservée, elle est simplement obtenue à la hauteur du système. Un primitif
// posé ici ne détonnerait plus.
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
} from '@breakery/ui';
import { todayIsoDate } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useRecordCashMovement, type CashMovementType } from '../hooks/useRecordCashMovement.js';

const TYPES: { value: CashMovementType; label: string; needsWallet?: boolean; requiresAdjust?: boolean }[] = [
  { value: 'undepo_to_petty',   label: 'Transfer Undeposited → Petty Cash' },
  { value: 'petty_to_undepo',   label: 'Return Petty Cash → Undeposited' },
  { value: 'bank_deposit',      label: 'Bank deposit' },
  { value: 'boss_withdrawal',   label: 'Boss withdrawal',                  requiresAdjust: true },
  { value: 'small_money_lend',  label: 'Small Money lends to Undeposited' },
  { value: 'small_money_repay', label: 'Repay Small Money' },
  { value: 'adjustment_gain',   label: 'Adjustment — count overage',       needsWallet: true, requiresAdjust: true },
  { value: 'adjustment_loss',   label: 'Adjustment — count shortage',      needsWallet: true, requiresAdjust: true },
];

const ADJUST_TYPES = new Set<CashMovementType>(['adjustment_gain', 'adjustment_loss', 'boss_withdrawal']);
const DEFAULT_TYPE: CashMovementType = 'undepo_to_petty';

// `border-border-strong` : la bordure d'un CHAMP est un objet graphique, elle
// doit tenir le 3:1 de WCAG 1.4.11 — `border-border-subtle` sépare des blocs,
// il ne dessine pas une zone de saisie.
const inputCls =
  `h-touch-min w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;

export function RecordCashMovementModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const canAdjust = useAuthStore((s) => s.hasPermission('accounting.cash.adjust'));

  const [type, setType]     = useState<CashMovementType>(DEFAULT_TYPE);
  const [amount, setAmount] = useState('');
  // `todayIsoDate()` rend le jour MÉTIER en Asia/Makassar (ADR-019). Le
  // `new Date().toISOString().slice(0,10)` local qu'il remplace rendait la date
  // UTC : avant 08h WITA, un mouvement de caisse se pré-datait à la veille —
  // période potentiellement close.
  const [date, setDate]     = useState(todayIsoDate());
  const [remark, setRemark] = useState('');
  const [wallet, setWallet] = useState<'1110' | '1111' | '1117'>('1110');
  const mut                 = useRecordCashMovement();

  // Reset to a permitted default if the current selection is gated and perm is lost.
  useEffect(() => {
    if (!canAdjust && ADJUST_TYPES.has(type)) {
      setType(DEFAULT_TYPE);
    }
  }, [canAdjust, type]);

  const visibleTypes = TYPES.filter((t) => !t.requiresAdjust || canAdjust);
  const needsWallet = TYPES.find((t) => t.value === type)?.needsWallet ?? false;
  const amt = Number(amount);
  const valid = amt > 0 && (!needsWallet || remark.trim().length > 0);

  const submit = () => {
    if (!valid) return;
    mut.mutate(
      {
        movementType: type,
        amount: amt,
        movementDate: date,
        remark: remark.trim(),
        walletCode: needsWallet ? wallet : null,
      },
      {
        onSuccess: () => {
          setAmount('');
          setRemark('');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New cash movement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            Type
            <select
              className={inputCls}
              value={type}
              onChange={(e) => setType(e.target.value as CashMovementType)}
            >
              {visibleTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          {needsWallet && (
            <label className="block text-sm">
              Wallet
              <select
                className={inputCls}
                value={wallet}
                onChange={(e) => setWallet(e.target.value as '1110' | '1111' | '1117')}
              >
                <option value="1110">Undeposited Funds</option>
                <option value="1111">Petty Cash</option>
                <option value="1117">Small Money</option>
              </select>
            </label>
          )}

          <label className="block text-sm">
            Amount (IDR)
            <input
              className={inputCls}
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            Date
            <input
              className={inputCls}
              type="date" lang="id-ID"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            Remark{needsWallet ? ' (reason — required)' : ''}
            <input
              className={inputCls}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </label>

          {mut.isError && (
            <p className="text-sm text-danger">{(mut.error).message}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {/* `secondary size="sm"` (36 px) et non `ghost` par défaut (56 px) :
              * les modales du back-office déjà corrigées alignent leur paire sur
              * ce cran, et un « Cancel » plus HAUT que l'action terminale
              * inversait la hiérarchie de la paire. */}
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="ink" size="sm" onClick={submit} disabled={!valid || mut.isPending}>
              {mut.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
