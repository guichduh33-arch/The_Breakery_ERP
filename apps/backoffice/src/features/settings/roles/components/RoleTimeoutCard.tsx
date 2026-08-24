// apps/backoffice/src/features/settings/roles/components/RoleTimeoutCard.tsx
//
// ADR-031 — le délai d'inactivité migre de la page Security vers la fiche du
// rôle : c'est un attribut du rôle, pas une politique globale, et il se lit
// mieux à côté de ce que ce rôle peut faire.
//
// Bornes 5-480 minutes, tenues côté serveur par la contrainte CHECK et par
// `update_role_session_timeout_v2` (SUPER_ADMIN seul) ; le front les répète
// pour refuser l'envoi avant l'aller-retour, jamais pour s'y substituer.

import { useState, type JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { RBAC_MATRIX_KEY, rbacErrorMessage, type RbacRole } from '../hooks/useRbacMatrix.js';

const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

interface Props {
  role: RbacRole;
}

export function RoleTimeoutCard({ role }: Props): JSX.Element {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string>(String(role.session_timeout_minutes));

  const save = useMutation<boolean, Error, number>({
    mutationFn: async (minutes) => {
      const { data, error } = await supabase.rpc('update_role_session_timeout_v2', {
        p_role_code: role.code,
        p_minutes:   minutes,
      });
      if (error !== null) throw new Error(error.message);
      return Boolean(data);
    },
    onSuccess: async () => {
      toast.success('Session timeout updated.');
      await qc.invalidateQueries({ queryKey: RBAC_MATRIX_KEY });
    },
    onError: (error) => {
      toast.error(`Update failed: ${rbacErrorMessage(error)}`);
    },
  });

  const draftNum = Number(draft);
  const invalid  = !Number.isInteger(draftNum) || draftNum < MIN_MINUTES || draftNum > MAX_MINUTES;
  const dirty    = !invalid && draftNum !== role.session_timeout_minutes;

  return (
    <section className="space-y-3" aria-labelledby="role-timeout-heading">
      <h2 id="role-timeout-heading" className="text-xl">Session timeout</h2>
      <div className="space-y-3 rounded-lg border border-border-subtle p-4">
        <p className="text-sm text-text-secondary">
          Operators holding this role are signed out after this many minutes of
          inactivity. Bounds {MIN_MINUTES}–{MAX_MINUTES} minutes.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="role-timeout-input" className="text-sm text-text-primary">
            Timeout (minutes)
          </label>
          <input
            id="role-timeout-input"
            type="number"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); }}
            data-testid="role-timeout-input"
            className={`w-24 rounded-md border border-border-strong bg-bg-input px-2 py-1 text-sm ${FOCUS_RING}`}
          />
          {/* Avant → après : le chiffre courant reste lisible pendant la
              saisie, pour que l'opérateur voie ce qu'il remplace. */}
          <span className="font-data text-xs text-text-secondary" data-testid="role-timeout-preview">
            {dirty
              ? `${role.session_timeout_minutes} min → ${draftNum} min`
              : `Currently ${role.session_timeout_minutes} min`}
          </span>
          <button
            type="button"
            className={TOOLBAR_BTN_PRIMARY}
            disabled={!dirty || save.isPending}
            onClick={() => { save.mutate(draftNum); }}
            data-testid="role-timeout-save"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {invalid && (
          <p className="text-xs text-danger-as-text" data-testid="role-timeout-invalid">
            Must be a whole number between {MIN_MINUTES} and {MAX_MINUTES}.
          </p>
        )}
      </div>
    </section>
  );
}
