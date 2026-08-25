// apps/backoffice/src/features/settings/roles/components/DeleteRoleAction.tsx
//
// ADR-032 — la mort d'un rôle, en bas de sa fiche parce qu'elle se lit après
// tout le reste et jamais par accident.
//
// Deux refus que le serveur oppose de toute façon, et que l'écran énonce AVANT
// le clic plutôt que dans un toast d'échec : un rôle système ne se supprime
// pas, un rôle porté non plus. Le compte des porteurs se prend sur
// `useUsersList({ includeDeleted: true })` — la garde serveur compte
// `user_profiles` SANS filtrer `deleted_at` (la FK RESTRICT retient aussi les
// profils archivés), une liste qui les exclurait annoncerait « supprimable »
// un rôle que la RPC refuse.
//
// Pas de réassignation en masse ici : l'ADR-032 la laisse hors périmètre, la
// page Users est le seul endroit où l'on change le rôle de quelqu'un.

import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useUsersList } from '@/features/users/hooks/useUsersList.js';
import { useDeleteRole } from '../hooks/useDeleteRole.js';
import type { RbacRole } from '../hooks/useRbacMatrix.js';

export interface DeleteRoleActionProps {
  role: RbacRole;
}

export function DeleteRoleAction({ role }: DeleteRoleActionProps): JSX.Element {
  const navigate = useNavigate();
  const users    = useUsersList({ includeDeleted: true });
  const del      = useDeleteRole();

  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);

  const holders = useMemo(
    () => (users.data ?? []).filter((u) => u.role_code === role.code).length,
    [users.data, role.code],
  );

  // Une seule raison est affichée : la première qui s'oppose. Un rôle système
  // porté par personne reste bloqué pour ce qu'il est, pas pour ce qu'il porte.
  const blockedReason: string | null =
    role.is_system      ? 'System roles cannot be deleted.'
    : users.isLoading   ? 'Checking who holds this role…'
    : users.error !== null
      ? 'Could not check who holds this role.'
    : holders > 0       ? `Reassign ${holders} employee${holders > 1 ? 's' : ''} first, from the Users page.`
    : null;

  return (
    <section className="space-y-3" aria-labelledby="role-delete-heading">
      <h2 id="role-delete-heading" className="text-xl">Delete role</h2>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle px-4 py-3">
        <p className="max-w-xl text-sm text-text-secondary">
          Removes the role and every permission granted to it. Each removal is
          audit-logged. This cannot be undone.
          {blockedReason !== null && (
            <>
              {' '}
              <span className="text-danger-as-text" data-testid="role-delete-reason">
                {blockedReason}
              </span>
            </>
          )}
        </p>

        <Button
          variant="ghostDestructive"
          size="sm"
          type="button"
          disabled={blockedReason !== null}
          onClick={() => { setConfirmOpen(true); }}
          data-testid="role-delete-btn"
        >
          Delete role
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md" data-testid="role-delete-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-danger-as-text" aria-hidden />
              Delete role
            </DialogTitle>
            <DialogDescription>
              Delete <strong className="text-text-primary">{role.name}</strong>{' '}
              (<span className="font-mono">{role.code}</span>)? Its permissions
              go with it, and the code becomes free again. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              disabled={del.isPending}
              onClick={() => { setConfirmOpen(false); }}
            >
              Cancel
            </Button>
            <Button
              variant="ghostDestructive"
              type="button"
              disabled={del.isPending}
              data-testid="role-delete-confirm"
              onClick={() => {
                del.mutate(
                  { code: role.code },
                  {
                    onSuccess: () => {
                      setConfirmOpen(false);
                      void navigate('/backoffice/settings/roles');
                    },
                    onError: () => { setConfirmOpen(false); },
                  },
                );
              }}
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
