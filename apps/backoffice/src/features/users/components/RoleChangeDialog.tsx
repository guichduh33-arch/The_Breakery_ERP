// apps/backoffice/src/features/users/components/RoleChangeDialog.tsx
// Session 13 / Phase 5.D — Role change dialog with session-revoke warning.

import { useState, type JSX } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Select,
} from '@breakery/ui';
import { useUpdateUserRole } from '../hooks/useUpdateUserRole.js';

export interface RoleChangeDialogProps {
  userId:      string;
  currentRole: string;
  fullName:    string;
  roles:       { code: string; name: string }[];
  onClose:     () => void;
}

export function RoleChangeDialog(
  { userId, currentRole, fullName, roles, onClose }: RoleChangeDialogProps,
): JSX.Element {
  const [newRole, setNewRole] = useState<string>(
    roles.find((r) => r.code !== currentRole)?.code ?? currentRole,
  );
  const [reason, setReason] = useState<string>('');
  const [error,  setError]  = useState<string | null>(null);

  const updateRole = useUpdateUserRole();

  function handleSubmit() {
    if (reason.trim().length < 3) {
      setError('Reason must be at least 3 characters.');
      return;
    }
    if (newRole === currentRole) {
      setError('Pick a different role from the current one.');
      return;
    }
    setError(null);
    updateRole.mutate(
      { user_id: userId, new_role_code: newRole, reason: reason.trim() },
      {
        onSuccess: () => { onClose(); },
        onError:   (e) => { setError(e.message); },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            Update {fullName}&apos;s role. This will revoke all active sessions on every device,
            forcing them to sign in again with their PIN.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-text-secondary">
            <span className="uppercase tracking-wider">Current role: </span>
            <span className="font-mono">{currentRole}</span>
          </div>

          <div>
            <label htmlFor="rch-new" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              New role
            </label>
            <Select
              id="rch-new"
              value={newRole}
              onChange={(e) => { setNewRole(e.target.value); }}
              className="w-full"
            >
              {roles.map((r) => (
                <option key={r.code} value={r.code}>{r.name} ({r.code})</option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="rch-reason" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Reason
            </label>
            <input
              id="rch-reason"
              value={reason}
              onChange={(e) => { setReason(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              placeholder="e.g. promoted to shift lead"
              maxLength={200}
            />
            <p className="text-xs text-text-secondary mt-1">
              Recorded in the audit log next to the old → new role mapping.
            </p>
          </div>

          <div className="flex items-start gap-2 text-xs text-warning bg-warning-soft px-2 py-1.5 rounded border border-warning">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden />
            <span>Saving will sign this user out of every device immediately.</span>
          </div>

          {error !== null && (
            <div className="text-xs text-danger bg-danger-soft px-2 py-1.5 rounded">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={updateRole.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={updateRole.isPending}>
            {updateRole.isPending ? 'Saving…' : 'Apply role change'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
