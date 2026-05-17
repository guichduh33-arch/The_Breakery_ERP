// apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx
// Session 19 / Phase 3.A — Per-role session timeout editor (Thread B).
//
// Gated by settings.update for write. Lists every role with an editable
// idle timeout (5..480 min, enforced server-side by the CHECK constraint
// and by `update_role_session_timeout_v1`). Each save is audit-logged
// server-side.
//
// Decision refs : D7 (hook lives in @breakery/ui), D8 (per-role authoritative),
// D9 (audit logs on every change), D17 (auth-get-session returns timeout).

import { useState, type JSX } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';

interface RoleRow {
  code: string;
  name: string;
  session_timeout_minutes: number;
}

const ROLES_QUERY_KEY = ['admin', 'roles', 'timeouts'] as const;

export default function SecuritySettingsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('settings.read');
  const canEdit = hasPermission('settings.update');

  const qc = useQueryClient();
  const { data: roles, isLoading, error } = useQuery<RoleRow[], Error>({
    queryKey: ROLES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('code, name, session_timeout_minutes')
        .order('session_timeout_minutes', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as RoleRow[];
    },
  });

  const mutate = useMutation<boolean, Error, { code: string; minutes: number }>({
    mutationFn: async ({ code, minutes }) => {
      const { data, error } = await supabase.rpc(
        'update_role_session_timeout_v1',
        { p_role_code: code, p_minutes: minutes },
      );
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
    onSuccess: async () => {
      toast.success('Session timeout updated.');
      await qc.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
    onError: (e: Error) => {
      toast.error(`Update failed: ${e.message}`);
    },
  });

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view settings.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Security &amp; PIN</h1>
        <p className="text-text-secondary text-sm mt-1">
          Idle session timeout per role. Operators are signed out after this
          many minutes of inactivity. Bounds 5–480 minutes ; changes are
          audit-logged.
        </p>
        {!canEdit && (
          <p className="text-text-secondary text-xs italic mt-2">
            Read-only view — the <code>settings.update</code> permission is
            required to edit timeouts.
          </p>
        )}
      </div>

      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {error && <div className="text-red">Failed to load roles: {error.message}</div>}

      {!isLoading && !error && (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-left text-text-secondary">
              <tr>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Timeout (min)</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(roles ?? []).map((r) => (
                <SecurityRoleRow
                  key={r.code}
                  role={r}
                  canEdit={canEdit}
                  pending={mutate.isPending}
                  errorMessage={mutate.error?.message ?? null}
                  onSave={(minutes) => mutate.mutate({ code: r.code, minutes })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface SecurityRoleRowProps {
  role: RoleRow;
  canEdit: boolean;
  pending: boolean;
  errorMessage: string | null;
  onSave: (minutes: number) => void;
}

function SecurityRoleRow({ role, canEdit, pending, errorMessage, onSave }: SecurityRoleRowProps): JSX.Element {
  const [draft, setDraft] = useState<string>(String(role.session_timeout_minutes));
  const draftNum = Number(draft);
  const invalid = !Number.isInteger(draftNum) || draftNum < 5 || draftNum > 480;
  const dirty = draftNum !== role.session_timeout_minutes;

  return (
    <tr className="border-t border-border-subtle">
      <td className="px-4 py-2 font-mono">{role.code}</td>
      <td className="px-4 py-2">{role.name}</td>
      <td className="px-4 py-2">
        <input
          type="number"
          min={5}
          max={480}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canEdit}
          aria-label={`Timeout for ${role.code}`}
          data-testid={`timeout-input-${role.code}`}
          className="w-24 rounded-md border border-border-subtle bg-bg-base px-2 py-1 text-sm disabled:opacity-60"
        />
        {invalid && dirty && (
          <p className="mt-1 text-xs text-red" data-testid={`timeout-invalid-${role.code}`}>
            Must be an integer between 5 and 480.
          </p>
        )}
      </td>
      <td className="px-4 py-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={!canEdit || !dirty || invalid || pending}
          onClick={() => onSave(draftNum)}
          data-testid={`timeout-save-${role.code}`}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {errorMessage && dirty && (
          <p className="mt-1 text-xs text-red">Save failed: {errorMessage}</p>
        )}
      </td>
    </tr>
  );
}
