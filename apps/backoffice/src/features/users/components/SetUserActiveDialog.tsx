// Fenêtre de désactivation / réactivation d'un compte (S1-07).

import { useState, type JSX } from 'react';
import { Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/BackofficeUi.js';
import { setUserActiveErrorText, useSetUserActive } from '../hooks/useSetUserActive.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface SetUserActiveDialogProps {
  userId:   string;
  fullName: string;
  /** État VISÉ : `false` désactive, `true` réactive. */
  activate: boolean;
  onClose:  () => void;
}

export function SetUserActiveDialog(
  { userId, fullName, activate, onClose }: SetUserActiveDialogProps,
): JSX.Element {
  const [reason, setReason] = useState<string>('');
  const [error,  setError]  = useState<string | null>(null);
  const mutation = useSetUserActive();

  function handleSubmit() {
    if (reason.trim().length < 3) {
      setError('Reason must be at least 3 characters.');
      return;
    }
    setError(null);
    mutation.mutate(
      { user_id: userId, is_active: activate, reason: reason.trim() },
      {
        onSuccess: () => { onClose(); },
        onError:   (e) => { setError(setUserActiveErrorText(e)); },
      },
    );
  }

  const verb = activate ? 'Reactivate' : 'Deactivate';
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{verb} user</DialogTitle>
          <DialogDescription>
            {activate
              ? `${fullName} will be able to sign in again, with the same role and PIN.`
              : `${fullName} loses all access immediately and every open session is ended. The account and its history are kept, and it can be reactivated later.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="active-reason" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Reason
            </label>
            <input
              id="active-reason"
              value={reason}
              onChange={(e) => { setReason(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded placeholder:text-text-muted ${FOCUS_RING}`}
              placeholder={activate ? 'e.g. back from leave' : 'e.g. left the company'}
              maxLength={200}
            />
          </div>

          {error !== null && (
            <div role="alert" data-testid="set-active-error" className="text-xs px-2 py-1.5 rounded text-danger bg-danger-soft">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button variant="ink" onClick={handleSubmit} disabled={mutation.isPending} data-testid="set-active-confirm">
            {mutation.isPending ? 'Saving…' : `${verb} user`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
