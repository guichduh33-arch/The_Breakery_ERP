// apps/backoffice/src/features/users/components/DeleteUserDialog.tsx
// Session 13 / Phase 5.D — Delete user dialog with last-admin guard surfacing.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useDeleteUser, isLastAdminError } from '../hooks/useDeleteUser.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface DeleteUserDialogProps {
  userId:   string;
  fullName: string;
  onClose:  () => void;
}

export function DeleteUserDialog(
  { userId, fullName, onClose }: DeleteUserDialogProps,
): JSX.Element {
  const [reason, setReason] = useState<string>('');
  const [error,  setError]  = useState<string | null>(null);
  const [isLastAdmin, setIsLastAdmin] = useState<boolean>(false);

  const del = useDeleteUser();

  function handleSubmit() {
    if (reason.trim().length < 3) {
      setError('Reason must be at least 3 characters.');
      return;
    }
    setError(null);
    setIsLastAdmin(false);
    del.mutate(
      { user_id: userId, reason: reason.trim() },
      {
        onSuccess: () => { onClose(); },
        onError:   (e) => {
          if (isLastAdminError(e)) {
            setIsLastAdmin(true);
            setError(
              'This account is the last remaining ADMIN/SUPER_ADMIN. Promote another user first, then delete.',
            );
          } else {
            setError(e.message);
          }
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete user</DialogTitle>
          <DialogDescription>
            Soft-deletes {fullName}. The profile keeps its history but stops working for sign-in,
            and all active sessions are revoked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="del-reason" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Reason
            </label>
            <input
              id="del-reason"
              value={reason}
              onChange={(e) => { setReason(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded placeholder:text-text-muted ${FOCUS_RING}`}
              placeholder="e.g. left the company"
              maxLength={200}
            />
          </div>

          {error !== null && (
            <div
              role={isLastAdmin ? 'alert' : undefined}
              data-testid={isLastAdmin ? 'last-admin-guard' : 'delete-error'}
              className={`text-xs px-2 py-1.5 rounded ${
                isLastAdmin
                  ? 'text-danger bg-danger-soft border border-danger font-medium'
                  : 'text-danger bg-danger-soft'
              }`}
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            variant="ink"
            onClick={handleSubmit}
            disabled={del.isPending}
            // `text-white` était une couleur écrite en dur : le premier plan
            // d'un aplat rouge est un TOKEN (`--red-on-fill`), qui suit le thème.
            className="bg-danger hover:opacity-90 text-red-on-fill"
          >
            {del.isPending ? 'Deleting…' : 'Delete user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
