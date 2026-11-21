// apps/backoffice/src/features/promotions/components/PromotionActivateConfirm.tsx
//
// Décision 2026-11-21 : ACTIVER une promotion change les prix à la caisse en
// plein service — le geste se confirme. La désactivation reste directe (elle
// arrête une remise, elle n'en crée pas).

import type { JSX } from 'react';
import { Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogFooter, DialogTitle } from '@/components/BackofficeUi.js';
import type { PromotionListRow } from '../hooks/usePromotionsList.js';
import { activationSentence, promotionValueText } from '../promotionSummary.js';

export interface PromotionActivateConfirmProps {
  row: PromotionListRow | undefined;
  pending: boolean;
  onConfirm: (row: PromotionListRow) => void;
  onClose: () => void;
}

export function PromotionActivateConfirm({ row, pending, onConfirm, onClose }: PromotionActivateConfirmProps): JSX.Element {
  return (
    <Dialog open={row !== undefined} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="promotion-activate-confirm">
        <DialogTitle>Activate {row?.name}?</DialogTitle>
        <DialogDescription>
          {row !== undefined ? activationSentence(row, Date.now()) : null}
        </DialogDescription>
        {row !== undefined && (
          <p className="text-sm text-text-secondary">
            Value: <span className="font-data tabular-nums text-text-primary">{promotionValueText(row)}</span>
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ink"
            disabled={pending || row === undefined}
            onClick={() => { if (row !== undefined) onConfirm(row); }}
          >
            {pending ? 'Activating…' : 'Activate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
