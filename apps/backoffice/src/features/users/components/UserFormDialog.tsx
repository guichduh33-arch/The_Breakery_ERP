// apps/backoffice/src/features/users/components/UserFormDialog.tsx
// Session 13 / Phase 5.D — Modal form to create a new user.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useCreateUser } from '../hooks/useCreateUser.js';

export interface UserFormDialogProps {
  /** Called after a successful create (or on cancel). */
  onClose:   () => void;
  /** Called with the new user_profiles.id on success. */
  onCreated?: (newId: string) => void;
  /** Available role codes — sourced from the roles table. */
  roles:     Array<{ code: string; name: string }>;
}

export function UserFormDialog({ onClose, onCreated, roles }: UserFormDialogProps): JSX.Element {
  const [employeeCode, setEmployeeCode] = useState('');
  const [fullName,     setFullName]     = useState('');
  const [roleCode,     setRoleCode]     = useState(roles[0]?.code ?? 'CASHIER');
  const [pin,          setPin]          = useState('');
  const [error,        setError]        = useState<string | null>(null);

  const createUser = useCreateUser();

  function handleSubmit() {
    if (employeeCode.trim().length < 3) {
      setError('Employee code must be at least 3 characters.');
      return;
    }
    if (fullName.trim().length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (!/^[0-9]{6}$/.test(pin)) {
      setError('PIN must be exactly 6 digits.');
      return;
    }
    setError(null);
    createUser.mutate(
      {
        employee_code: employeeCode.trim().toUpperCase(),
        full_name:     fullName.trim(),
        role_code:     roleCode,
        pin,
      },
      {
        onSuccess: (newId) => {
          if (onCreated) onCreated(newId);
          onClose();
        },
        onError: (e) => { setError(e.message); },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>
            Creates a staff profile. PIN authentication; staff sign in on POS/backoffice with this PIN.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="usr-emp" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Employee code
            </label>
            <input
              id="usr-emp"
              value={employeeCode}
              onChange={(e) => { setEmployeeCode(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded font-mono uppercase"
              placeholder="EMP004"
              maxLength={16}
            />
          </div>

          <div>
            <label htmlFor="usr-name" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Full name
            </label>
            <input
              id="usr-name"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              placeholder="Jane Doe"
              maxLength={120}
            />
          </div>

          <div>
            <label htmlFor="usr-role" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Role
            </label>
            <select
              id="usr-role"
              value={roleCode}
              onChange={(e) => { setRoleCode(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
            >
              {roles.map((r) => (
                <option key={r.code} value={r.code}>{r.name} ({r.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="usr-pin" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              PIN (exactly 6 digits)
            </label>
            <input
              id="usr-pin"
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/[^0-9]/g, '')); }}
              type="password"
              inputMode="numeric"
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded font-mono"
              placeholder="••••••"
              maxLength={6}
            />
            <p className="text-xs text-text-secondary mt-1">
              The PIN is bcrypt-hashed server-side. Communicate it securely to the user.
            </p>
          </div>

          {error !== null && (
            <div className="text-xs text-rose-600 bg-rose-50 px-2 py-1.5 rounded">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={createUser.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createUser.isPending}>
            {createUser.isPending ? 'Creating…' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
