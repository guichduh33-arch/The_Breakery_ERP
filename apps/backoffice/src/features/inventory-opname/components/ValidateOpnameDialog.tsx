// apps/backoffice/src/features/inventory-opname/components/ValidateOpnameDialog.tsx
//
// Valider un inventaire, c'est révéler les écarts — et c'est un point de
// non-retour : aucune RPC ne ramène un inventaire de `review` vers `counting`,
// et la saisie se fige dès la revue. La seule issue en cas d'erreur de frappe
// découverte à la révélation est d'annuler l'inventaire et de tout recompter.
//
// Ce dialogue existe pour que ce soit dit AVANT le clic. Auparavant Valider
// était un clic direct, sans confirmation — acceptable tant que la saisie
// restait ouverte après, plus du tout maintenant.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useValidateOpname } from '../hooks/useOpnameMutations.js';

export interface ValidateOpnameDialogProps {
  countId:      string;
  /** Nombre de lignes comptées — ce qui sera comparé à l'attendu. */
  countedItems: number;
  onClose:      () => void;
}

export function ValidateOpnameDialog({
  countId,
  countedItems,
  onClose,
}: ValidateOpnameDialogProps): JSX.Element {
  const validate = useValidateOpname();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(): void {
    setError(null);
    validate.mutate(
      { countId },
      {
        onSuccess: () => { onClose(); },
        onError:   (e) => { setError(e.message); },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reveal variances?</DialogTitle>
          <DialogDescription className="sr-only">
            Confirm moving this count to review, which reveals expected quantities
            and locks counted quantities.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-text-secondary">
          <p>
            This reveals the expected quantity and the variance for your{' '}
            <strong className="font-mono">{countedItems}</strong> counted line(s).
          </p>
          <p>
            <strong className="text-text-primary">Counted quantities are locked
            from then on.</strong> There is no way back to counting: if you spot a
            typo once the variances are visible, the only option is to cancel this
            count and recount from scratch.
          </p>

          {error !== null && (
            <div role="alert" className="text-danger">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep counting</Button>
          <Button
            variant="ink"
            onClick={handleSubmit}
            disabled={validate.isPending}
            data-testid="confirm-validate"
          >
            {validate.isPending ? 'Validating…' : 'Reveal & lock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
