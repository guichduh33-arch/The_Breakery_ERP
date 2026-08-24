// apps/backoffice/src/features/settings/roles/components/UserOverridesPanel.tsx
//
// ADR-031 — les exceptions par personne, l'étage au-dessus du rôle. Une
// exception dit « cette personne-là, et elle seule, peut (ou ne peut pas) ceci
// malgré son rôle » ; elle porte donc toujours un motif, et souvent une
// échéance.
//
// Le sélecteur de personne exclut les profils SUPER_ADMIN : le serveur les
// refuse (`super_admin_target_locked`), les proposer serait promettre une
// action impossible.
//
// Contrôles natifs (`<select>`, `<input type="radio">`) : @breakery/ui
// n'exporte ni Select ni RadioGroup.

import { useMemo, useState, type JSX } from 'react';
import {
  Badge, Button,
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@breakery/ui';
import { Plus, Trash2 } from 'lucide-react';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useUsersList } from '@/features/users/hooks/useUsersList.js';
import { useRbacMatrix, SUPER_ADMIN_ROLE, type RbacOverride } from '../hooks/useRbacMatrix.js';
import { useSetUserOverride } from '../hooks/useSetUserOverride.js';
import { useDeleteUserOverride } from '../hooks/useDeleteUserOverride.js';

const LABEL_CLS  = 'text-xs uppercase tracking-widest text-text-secondary';
const FIELD_CLS  = `h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;

const REASON_MIN = 3;
const REASON_MAX = 200;

interface Props {
  roleCode: string;
}

export function UserOverridesPanel({ roleCode }: Props): JSX.Element {
  const matrix = useRbacMatrix();
  const users  = useUsersList();
  const remove = useDeleteUserOverride();

  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [pendingDelete, setPendingDelete] = useState<RbacOverride | null>(null);

  /** Les profils de CE rôle — SUPER_ADMIN exclu, le serveur le refuse. */
  const roleUsers = useMemo(
    () => (users.data ?? []).filter(
      (u) => u.role_code === roleCode && u.role_code !== SUPER_ADMIN_ROLE && u.deleted_at === null,
    ),
    [users.data, roleCode],
  );

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users.data ?? []) map.set(u.id, u.full_name);
    return map;
  }, [users.data]);

  const rows = useMemo(() => {
    const ids = new Set(roleUsers.map((u) => u.id));
    return (matrix.data?.overrides ?? []).filter((o) => ids.has(o.user_profile_id));
  }, [matrix.data?.overrides, roleUsers]);

  const canAdd = roleUsers.length > 0;

  return (
    <section className="space-y-3" aria-labelledby="role-overrides-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="role-overrides-heading" className="text-xl">User overrides</h2>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canAdd}
          onClick={() => { setAddOpen(true); }}
          data-testid="override-add-btn"
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Add override
        </Button>
      </div>

      <p className="text-sm text-text-secondary">
        Exceptions granted to a single person, on top of this role. Each one
        carries a reason and is audit-logged.
      </p>

      {matrix.error !== null && (
        <div className="text-sm text-danger-as-text" data-testid="overrides-error">
          Failed to load overrides: {matrix.error.message}
        </div>
      )}

      {!canAdd && roleCode === SUPER_ADMIN_ROLE && (
        <p className="rounded border border-border-subtle bg-surface-inert px-3 py-2 text-xs text-text-secondary">
          A SUPER_ADMIN profile cannot carry an override.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded border border-border-subtle px-3 py-6 text-sm text-text-secondary"
           data-testid="overrides-empty">
          No override for this role. Everyone holding it gets exactly what the
          role grants.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <caption className="sr-only">
              One row per exception: the person, the permission, whether it is
              granted or denied, the reason, the expiry, and who set it.
            </caption>
            <thead className="bg-surface-inert text-left text-text-secondary">
              <tr>
                <th scope="col" className="px-4 py-2">User</th>
                <th scope="col" className="px-4 py-2">Permission</th>
                <th scope="col" className="px-4 py-2">Effect</th>
                <th scope="col" className="px-4 py-2">Reason</th>
                <th scope="col" className="px-4 py-2">Expires</th>
                <th scope="col" className="px-4 py-2">Set by</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={`${o.user_profile_id}-${o.permission_code}`} className="border-t border-border-subtle">
                  <td className="px-4 py-2">{nameById.get(o.user_profile_id) ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{o.permission_code}</td>
                  <td className="px-4 py-2">
                    <Badge variant={o.is_granted ? 'success' : 'destructive'}>
                      {o.is_granted ? 'Grant' : 'Deny'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-text-secondary">{o.reason}</td>
                  <td className="px-4 py-2 font-data text-xs">
                    {o.expires_at !== null ? o.expires_at.slice(0, 10) : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-xs text-text-secondary">
                    {o.granted_by !== null ? (nameById.get(o.granted_by) ?? '—') : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => { setPendingDelete(o); }}
                      aria-label={`Remove override ${o.permission_code}`}
                      data-testid={`override-remove-${o.permission_code}`}
                      className={`rounded p-1 text-text-secondary hover:bg-surface-4 ${FOCUS_RING}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddOverrideDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        users={roleUsers.map((u) => ({ id: u.id, name: u.full_name }))}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this override?</DialogTitle>
            <DialogDescription>
              {pendingDelete !== null && (
                <>
                  {nameById.get(pendingDelete.user_profile_id) ?? 'This user'} goes
                  back to exactly what the role grants for{' '}
                  <span className="font-mono">{pendingDelete.permission_code}</span>.
                  This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={() => { setPendingDelete(null); }}>
              Cancel
            </Button>
            <Button
              variant="ink"
              type="button"
              disabled={remove.isPending}
              data-testid="override-remove-confirm"
              onClick={() => {
                if (pendingDelete === null) return;
                remove.mutate(
                  {
                    userProfileId:  pendingDelete.user_profile_id,
                    permissionCode: pendingDelete.permission_code,
                  },
                  { onSettled: () => { setPendingDelete(null); } },
                );
              }}
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Dialogue d'ajout ────────────────────────────────────────────────────────

interface AddDialogProps {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  users:        { id: string; name: string }[];
}

function AddOverrideDialog({ open, onOpenChange, users }: AddDialogProps): JSX.Element {
  const matrix = useRbacMatrix();
  const save   = useSetUserOverride();

  const [userId, setUserId]         = useState<string>('');
  const [permission, setPermission] = useState<string>('');
  const [granted, setGranted]       = useState<boolean>(true);
  const [reason, setReason]         = useState<string>('');
  const [expiresAt, setExpiresAt]   = useState<string>('');

  const permissions = matrix.data?.permissions ?? [];
  const reasonLength = reason.trim().length;
  const reasonInvalid = reasonLength < REASON_MIN || reasonLength > REASON_MAX;
  const canSubmit = userId !== '' && permission !== '' && !reasonInvalid && !save.isPending;

  function reset(): void {
    setUserId('');
    setPermission('');
    setGranted(true);
    setReason('');
    setExpiresAt('');
  }

  function submit(): void {
    save.mutate(
      {
        userProfileId:  userId,
        permissionCode: permission,
        granted,
        reason:         reason.trim(),
        // `datetime-local` rend « 2026-08-25T14:30 » — sans fuseau. Postgres
        // l'interprète dans le fuseau de session (Asia/Makassar), qui EST le
        // fuseau métier : l'heure saisie est donc l'heure locale voulue.
        expiresAt:      expiresAt === '' ? null : expiresAt,
      },
      {
        onSuccess: () => { reset(); onOpenChange(false); },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a user override</DialogTitle>
          <DialogDescription>
            Grants or denies one permission to one person, on top of their role.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="override-user" className={LABEL_CLS}>User</label>
            <select
              id="override-user"
              className={FIELD_CLS}
              value={userId}
              onChange={(e) => { setUserId(e.target.value); }}
              data-testid="override-user-select"
            >
              <option value="">Select a user…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="override-permission" className={LABEL_CLS}>Permission</label>
            <select
              id="override-permission"
              className={FIELD_CLS}
              value={permission}
              onChange={(e) => { setPermission(e.target.value); }}
              data-testid="override-permission-select"
            >
              <option value="">Select a permission…</option>
              {permissions.map((p) => (
                <option key={p.code} value={p.code}>{p.code}</option>
              ))}
            </select>
          </div>

          <fieldset className="space-y-1">
            <legend className={LABEL_CLS}>Effect</legend>
            <div className="flex items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="override-effect"
                  checked={granted}
                  onChange={() => { setGranted(true); }}
                  data-testid="override-effect-grant"
                  className={`h-4 w-4 accent-gold ${FOCUS_RING}`}
                />
                Grant
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="override-effect"
                  checked={!granted}
                  onChange={() => { setGranted(false); }}
                  data-testid="override-effect-deny"
                  className={`h-4 w-4 accent-gold ${FOCUS_RING}`}
                />
                Deny
              </label>
            </div>
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="override-reason" className={LABEL_CLS}>Reason</label>
            <input
              id="override-reason"
              className={`${FIELD_CLS} placeholder:text-text-muted`}
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => { setReason(e.target.value); }}
              placeholder="Why this person needs the exception"
              data-testid="override-reason-input"
            />
            <p className="text-xs text-text-muted">
              {REASON_MIN}–{REASON_MAX} characters. Stored with the override and
              shown in the audit trail.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="override-expires" className={LABEL_CLS}>Expires (optional)</label>
            <input
              id="override-expires"
              type="datetime-local"
              className={FIELD_CLS}
              value={expiresAt}
              onChange={(e) => { setExpiresAt(e.target.value); }}
              data-testid="override-expires-input"
            />
            <p className="text-xs text-text-muted">
              Leave empty for an override that never expires.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button
            variant="ink"
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            data-testid="override-submit"
          >
            {save.isPending ? 'Saving…' : 'Save override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
