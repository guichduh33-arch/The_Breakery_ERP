// apps/backoffice/src/features/settings/roles/components/CreateRoleDialog.tsx
//
// ADR-032 — la naissance d'un rôle tient en un dialogue. Deux façons d'en
// obtenir un : vierge de toute permission, ou cloné d'un rôle existant — y
// compris d'un rôle système, qu'on ne peut pas modifier mais qu'on peut
// prendre pour patron (« Cashier Senior »).
//
// Les contrôles de ce formulaire DOUBLENT ceux de la RPC, ils ne les
// remplacent pas : ils épargnent un aller-retour à l'opérateur, l'autorité
// reste `create_role_v1`.
//
// Contrôle natif (`<select>`) : @breakery/ui n'exporte pas de Select.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useRbacMatrix } from '../hooks/useRbacMatrix.js';
import { useCreateRole } from '../hooks/useCreateRole.js';

const LABEL_CLS = 'text-xs uppercase tracking-widest text-text-secondary';
const FIELD_CLS = `h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;
const HINT_CLS  = 'text-xs text-text-muted';

/** Miroir exact du contrôle serveur — `^[A-Za-z][A-Za-z0-9_]{2,29}$`. */
const CODE_RE    = /^[A-Za-z][A-Za-z0-9_]{2,29}$/;
const NAME_MIN   = 2;
const NAME_MAX   = 60;
const DESC_MAX   = 200;
const TIMEOUT_MIN = 5;
const TIMEOUT_MAX = 480;

export interface CreateRoleDialogProps {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateRoleDialog({ open, onOpenChange }: CreateRoleDialogProps): JSX.Element {
  const matrix = useRbacMatrix();
  const create = useCreateRole();

  const [code, setCode]           = useState<string>('');
  const [name, setName]           = useState<string>('');
  const [description, setDesc]    = useState<string>('');
  const [timeout, setTimeoutStr]  = useState<string>('');
  const [cloneFrom, setCloneFrom] = useState<string>('');

  const roles = matrix.data?.roles ?? [];

  const codeInvalid = code !== '' && !CODE_RE.test(code);
  const trimmedName = name.trim();
  const nameInvalid = name !== '' && (trimmedName.length < NAME_MIN || name.length > NAME_MAX);

  // Vide est LÉGITIME — le serveur hérite alors du rôle source, ou retombe sur
  // 30 minutes. Seule une valeur saisie hors bornes est une erreur.
  const timeoutNum     = timeout === '' ? null : Number(timeout);
  const timeoutInvalid =
    timeoutNum !== null &&
    (!Number.isInteger(timeoutNum) || timeoutNum < TIMEOUT_MIN || timeoutNum > TIMEOUT_MAX);

  const canSubmit =
    CODE_RE.test(code) &&
    trimmedName.length >= NAME_MIN &&
    name.length <= NAME_MAX &&
    description.length <= DESC_MAX &&
    !timeoutInvalid &&
    !create.isPending;

  function reset(): void {
    setCode('');
    setName('');
    setDesc('');
    setTimeoutStr('');
    setCloneFrom('');
  }

  function close(next: boolean): void {
    if (!next) reset();
    onOpenChange(next);
  }

  function submit(): void {
    create.mutate(
      {
        code,
        name: trimmedName,
        description:           description.trim() === '' ? null : description.trim(),
        sessionTimeoutMinutes: timeoutNum,
        cloneFrom:             cloneFrom === '' ? null : cloneFrom,
      },
      { onSuccess: () => { reset(); onOpenChange(false); } },
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg" data-testid="create-role-dialog">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            A role created here is never a system role: it can be edited and
            deleted afterwards. Its permissions are set on its own page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="new-role-code" className={LABEL_CLS}>Code</label>
            <input
              id="new-role-code"
              className={`${FIELD_CLS} font-mono placeholder:text-text-muted`}
              value={code}
              maxLength={30}
              onChange={(e) => { setCode(e.target.value); }}
              placeholder="CASHIER_SENIOR"
              aria-invalid={codeInvalid}
              data-testid="new-role-code"
            />
            {codeInvalid ? (
              <p className="text-xs text-danger-as-text" data-testid="new-role-code-invalid">
                Start with a letter, then 3 to 30 letters, digits or underscores.
              </p>
            ) : (
              <p className={HINT_CLS}>
                3 to 30 characters, starting with a letter. Letters, digits and
                underscores only. Permanent — a code is never renamed.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="new-role-name" className={LABEL_CLS}>Name</label>
            <input
              id="new-role-name"
              className={`${FIELD_CLS} placeholder:text-text-muted`}
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => { setName(e.target.value); }}
              placeholder="Cashier Senior"
              aria-invalid={nameInvalid}
              data-testid="new-role-name"
            />
            {nameInvalid ? (
              <p className="text-xs text-danger-as-text" data-testid="new-role-name-invalid">
                The name must be {NAME_MIN} to {NAME_MAX} characters long.
              </p>
            ) : (
              <p className={HINT_CLS}>Shown wherever the role appears.</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="new-role-description" className={LABEL_CLS}>
              Description (optional)
            </label>
            <input
              id="new-role-description"
              className={`${FIELD_CLS} placeholder:text-text-muted`}
              value={description}
              maxLength={DESC_MAX}
              onChange={(e) => { setDesc(e.target.value); }}
              placeholder="What this role is for"
              data-testid="new-role-description"
            />
            <p className={HINT_CLS}>{DESC_MAX} characters at most.</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="new-role-timeout" className={LABEL_CLS}>
              Session timeout (optional)
            </label>
            <input
              id="new-role-timeout"
              type="number"
              min={TIMEOUT_MIN}
              max={TIMEOUT_MAX}
              className={`${FIELD_CLS} font-data placeholder:text-text-muted`}
              value={timeout}
              onChange={(e) => { setTimeoutStr(e.target.value); }}
              placeholder="30"
              aria-invalid={timeoutInvalid}
              data-testid="new-role-timeout"
            />
            {timeoutInvalid ? (
              <p className="text-xs text-danger-as-text" data-testid="new-role-timeout-invalid">
                Between {TIMEOUT_MIN} and {TIMEOUT_MAX} minutes.
              </p>
            ) : (
              <p className={HINT_CLS}>
                Minutes of inactivity before sign-out. Leave empty to inherit
                from the cloned role, or to take the 30-minute default.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="new-role-clone" className={LABEL_CLS}>
              Clone permissions from (optional)
            </label>
            <select
              id="new-role-clone"
              className={FIELD_CLS}
              value={cloneFrom}
              onChange={(e) => { setCloneFrom(e.target.value); }}
              data-testid="new-role-clone"
            >
              <option value="">No permission — start from an empty role</option>
              {roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
            <p className={HINT_CLS}>
              Copies every permission the source role grants, except
              <span className="font-mono"> rbac.manage</span>, which stays with
              SUPER_ADMIN.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={() => { close(false); }}>
            Cancel
          </Button>
          <Button
            variant="ink"
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            data-testid="new-role-submit"
          >
            {create.isPending ? 'Creating…' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
