// apps/backoffice/src/features/orders/components/VoidOrderModal.tsx
// Session 33 / Wave 3.4 — modal to void an order from the BO list page.
// Reason textarea (min 10 chars) + 6-digit manager PIN. Submit disabled
// until both validate. PIN travels in the `x-manager-pin` header (S34);
// idempotency key in `x-idempotency-key` (S55 parity, S60).

import { useState, useRef, type JSX } from 'react';
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@breakery/ui';
import { useVoidOrder } from '@/features/orders/hooks/useVoidOrder.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { FOCUS_RING } from '@/components/focusRing.js';

/**
 * Traduction des JETONS de l'EF `void-order`. `useVoidOrder` construit son
 * `Error` avec `err.error ?? 'void_failed'` — c'est-à-dire, TOUJOURS, un jeton
 * machine : `order_not_voidable`, `cross_shift_not_allowed`, `wrong_pin`… La
 * fenêtre les rendait bruts dans un `role="alert"`, donc un lecteur d'écran les
 * ÉPELAIT (critique du 2026-08-26). Même forme que `AnnualCloseModal` : une map
 * locale au geste, parce que la phrase juste dépend de ce que l'écran propose
 * de faire ensuite, pas seulement du code.
 *
 * Les clés viennent de `supabase/functions/void-order/index.ts` — les rejets de
 * garde (méthode, JSON, PIN, idempotence) comme les codes que la RPC remonte.
 */
const ERROR_COPY: Record<string, string> = {
  missing_manager_pin:            'Manager PIN is required.',
  invalid_pin_format:             'PIN must be exactly 6 digits.',
  wrong_pin:                      'Invalid manager PIN.',
  authorization_required:         'Your session expired. Sign in again.',
  not_authenticated:              'Your session expired. Sign in again.',
  permission_denied:              'You do not have permission to void an order (needs orders.void).',
  not_found:                      'This order no longer exists.',
  reason_too_short:               'Reason must be at least 10 characters.',
  invalid_order_id:               'This order reference is not valid.',
  invalid_idempotency_key:        'Retry key rejected — close this window and start again.',
  cross_shift_not_allowed:        'This order belongs to a closed shift and can no longer be voided.',
  cash_void_requires_open_session:'A cash payment can only be voided while its POS session is open.',
  check_violation:                'The server refused this void — the order is no longer in a voidable state.',
  method_not_allowed:             'Something went wrong. Please retry.',
  invalid_json:                   'Something went wrong. Please retry.',
  internal_error:                 'Something went wrong. Please retry.',
  void_failed:                    'Something went wrong. Please retry.',
  unknown:                        'Something went wrong. Please retry.',
};

/**
 * Phrase affichable pour une erreur de void. Le jeton connu gagne ; sinon on
 * repasse par `errorDetailText`, dont toute la doctrine est de TAIRE ce qui
 * n'est pas lisible (jeton snake_case, code Postgres, « [object Object] »). Un
 * message serveur en clair — un `logAndRedact` d'un 500, par exemple — passe
 * donc, et rien d'autre ne fuit à l'écran.
 */
export function voidErrorText(e: unknown): string {
  const code = e instanceof Error ? e.message : '';
  return ERROR_COPY[code] ?? errorDetailText(e) ?? ERROR_COPY.unknown!;
}

interface Props {
  open:        boolean;
  onClose:     () => void;
  orderId:     string;
  orderNumber: string;
}

export function VoidOrderModal({ open, onClose, orderId, orderNumber }: Props): JSX.Element {
  const [reason, setReason] = useState('');
  const [pin, setPin]       = useState('');
  const idem = useRef(crypto.randomUUID());
  const m = useVoidOrder();

  const reasonOk = reason.trim().length >= 10;
  const pinOk    = /^\d{6}$/.test(pin);
  const canSubmit = reasonOk && pinOk && !m.isPending;

  const handleClose = (): void => {
    idem.current = crypto.randomUUID();
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    try {
      await m.mutateAsync({ orderId, reason, managerPin: pin, idempotencyKey: idem.current });
      onClose();
      setReason('');
      setPin('');
      idem.current = crypto.randomUUID();
    } catch {
      // m.error displayed below
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      {/* `alertdialog` et non `dialog` (critique du 2026-08-21) : la fenêtre ne
          demande pas un renseignement, elle annonce une conséquence
          irréversible. Le rôle fait annoncer la description AVANT le premier
          champ par les lecteurs d'écran, au lieu de la laisser en note qu'on
          n'entend qu'en revenant en arrière. Radix transmet la prop telle
          quelle et elle écrase le rôle par défaut du contenu. */}
      <DialogContent className="max-w-md" role="alertdialog">
        <DialogTitle>Void order {orderNumber}</DialogTitle>
        <DialogDescription className="sr-only">
          Voids the order, restoring inventory to stock. This action cannot be undone.
        </DialogDescription>
        <p className="rounded bg-danger-soft border border-danger p-3 text-sm text-danger">
          This action cannot be undone. Inventory will be restored to stock.
        </p>
        {/* Critique /impeccable 2026-08-13 (P1) — un lecteur d'écran entendait
            « edit text » deux fois sans savoir laquelle était le PIN : labels
            sans htmlFor, champs sans id, erreur jamais rattachée au champ. */}
        <div>
          <label htmlFor="void-reason-input" className="block text-sm font-medium">Reason for voiding</label>
          <textarea
            id="void-reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className={`mt-1 w-full border border-border-strong rounded p-2 text-sm placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="Min. 10 characters…"
            aria-invalid={reason.length > 0 && !reasonOk}
            aria-describedby={reason.length > 0 && !reasonOk ? 'void-reason-error' : undefined}
            data-testid="void-reason"
          />
          {!reasonOk && reason.length > 0 && (
            <p id="void-reason-error" className="text-xs text-danger mt-1">Min. 10 characters</p>
          )}
        </div>
        {/* Le champ au-dessus annonce sa contrainte (« Min. 10 characters ») et
            rattache son message d'erreur ; celui-ci n'avait NI l'un NI l'autre,
            alors qu'il porte la même règle côté serveur (`invalid_pin_format`)
            et qu'il est masqué — donc invérifiable à l'œil. Même patron : un
            indice permanent, un message quand la saisie est entamée et fausse,
            les deux sous le même `id` puisqu'ils s'excluent. */}
        <div>
          <label htmlFor="void-pin-input" className="block text-sm font-medium">Manager PIN</label>
          <input
            id="void-pin-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className={`mt-1 h-touch-min w-full border border-border-strong rounded px-2 text-sm tracking-widest ${FOCUS_RING}`}
            aria-invalid={pin.length > 0 && !pinOk}
            aria-describedby="void-pin-hint"
            data-testid="void-pin"
          />
          {!pinOk && pin.length > 0 ? (
            <p id="void-pin-hint" className="text-xs text-danger mt-1">Exactly 6 digits</p>
          ) : (
            <p id="void-pin-hint" className="text-xs text-text-muted mt-1">6 digits</p>
          )}
        </div>
        {m.error && (
          <p role="alert" className="text-sm text-danger-as-text" data-testid="void-error">
            {voidErrorText(m.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={handleClose} className="px-4 py-2 text-sm" data-testid="void-cancel">Cancel</button>
          <button
            onClick={() => { void handleSubmit(); }}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-danger text-white rounded disabled:opacity-50"
            data-testid="void-submit"
          >
            {m.isPending ? 'Voiding…' : 'Void order'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
