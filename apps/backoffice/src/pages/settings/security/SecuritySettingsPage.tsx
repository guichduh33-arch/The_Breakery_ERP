// apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx
// Session 19 / Phase 3.A — Per-role session timeout editor (Thread B).
//
// ADR-006 déc. 9 (PIN policy) — la page devient « Security » : timeouts de
// session par rôle + politique de lockout PIN (pin_max_failed 3-10,
// pin_lockout_minutes 5-120, catégorie settings `security`, lue par l'EF
// auth-verify-pin à chaque login).
//
// Route access is gated by settings.security.manage (routes/index.tsx);
// editing is gated by settings.update (mirrors the RPC gate). Lists every
// role with an editable idle timeout (5..480 min, enforced server-side by
// the CHECK constraint and by `update_role_session_timeout_v1`). Each save
// is audit-logged server-side.
//
// Decision refs : D7 (hook lives in @breakery/ui), D8 (per-role authoritative),
// D9 (audit logs on every change), D17 (auth-get-session returns timeout).

import { useEffect, useState, type JSX } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

interface RoleRow {
  code: string;
  name: string;
  session_timeout_minutes: number;
}

const ROLES_QUERY_KEY = ['admin', 'roles', 'timeouts'] as const;

export default function SecuritySettingsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
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
      return (data ?? []);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Security</h1>
        <p className="text-text-secondary text-sm mt-1">
          Per-role idle limits and PIN lockout policy. Changes are
          audit-logged.
        </p>
        {!canEdit && (
          <p className="text-text-secondary text-xs italic mt-2">
            Read-only view — the <code>settings.update</code> permission is
            required to edit.
          </p>
        )}
      </div>

      <div>
        <h2 className="font-serif text-xl">Session timeouts</h2>
        <p className="text-text-secondary text-sm mt-1">
          Idle session timeout per role. Operators are signed out after this
          many minutes of inactivity. Bounds 5–480 minutes.
        </p>
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

      <PinPolicyCard canEdit={canEdit} />
    </div>
  );
}

// ── PIN policy (ADR-006 déc. 9) ──────────────────────────────────────────────
// Lockout du login PIN : nombre de tentatives avant verrouillage + durée du
// verrouillage. Lu par l'EF auth-verify-pin à chaque login (fallback 5/15).

interface PinPolicyField {
  key: 'pin_max_failed' | 'pin_lockout_minutes';
  label: string;
  hint: string;
  min: number;
  max: number;
  fallback: number;
}

const PIN_FIELDS: PinPolicyField[] = [
  {
    key: 'pin_max_failed', label: 'Failed attempts before lockout',
    hint: '3–10 attempts', min: 3, max: 10, fallback: 5,
  },
  {
    key: 'pin_lockout_minutes', label: 'Lockout duration (minutes)',
    hint: '5–120 minutes', min: 5, max: 120, fallback: 15,
  },
];

function PinPolicyCard({ canEdit }: { canEdit: boolean }): JSX.Element {
  const security = useSettings('security');
  const setSetting = useSetSetting();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!security.data) return;
    const raw = security.data.settings;
    setDraft(Object.fromEntries(PIN_FIELDS.map((f) => {
      const v = raw[f.key];
      return [f.key, String(typeof v === 'number' ? v : f.fallback)];
    })));
  }, [security.data]);

  function fieldState(f: PinPolicyField): { value: string; invalid: boolean; dirty: boolean } {
    const value = draft?.[f.key] ?? String(f.fallback);
    const n = Number(value);
    const invalid = !Number.isInteger(n) || n < f.min || n > f.max;
    const raw = security.data?.settings[f.key];
    const original = typeof raw === 'number' ? raw : f.fallback;
    return { value, invalid, dirty: !invalid && n !== original };
  }

  const states = PIN_FIELDS.map((f) => ({ f, ...fieldState(f) }));
  const anyInvalid = states.some((s) => s.invalid);
  const anyDirty = states.some((s) => s.dirty);

  function handleSave(): void {
    // Une mutation par clé sale — une entrée d'audit par changement.
    for (const s of states) {
      if (!s.dirty) continue;
      setSetting.mutate(
        { key: s.f.key, value: Number(s.value), category: 'security' },
        {
          onSuccess: () => { toast.success(`${s.f.label} updated.`); },
          onError: (e) => { toast.error(`Update failed: ${e.message}`); },
        },
      );
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl">PIN policy</h2>
        <p className="text-text-secondary text-sm mt-1">
          Login PIN lockout, applied by the sign-in flow on every attempt:
          after the configured number of failed attempts, the account locks
          for the configured duration.
        </p>
      </div>
      <div className="rounded-lg border border-border-subtle p-4 space-y-3">
        {states.map(({ f, value, invalid }) => (
          <div key={f.key} className="flex flex-wrap items-center gap-3">
            <label htmlFor={`pin-${f.key}`} className="w-72 text-sm">{f.label}</label>
            <input
              id={`pin-${f.key}`}
              type="number"
              min={f.min}
              max={f.max}
              value={value}
              disabled={!canEdit || draft === null}
              onChange={(e) => {
                setDraft((prev) => (prev === null ? prev : { ...prev, [f.key]: e.target.value }));
              }}
              data-testid={`pin-input-${f.key}`}
              className="w-24 rounded-md border border-border-subtle bg-bg-input px-2 py-1 text-sm"
            />
            <span className="text-xs text-text-muted">{f.hint}</span>
            {invalid && (
              <span className="text-xs text-danger" data-testid={`pin-invalid-${f.key}`}>
                Out of bounds.
              </span>
            )}
          </div>
        ))}
        <Button
          variant="gold"
          size="sm"
          onClick={handleSave}
          disabled={!canEdit || anyInvalid || !anyDirty || setSetting.isPending}
          data-testid="pin-policy-save"
        >
          {setSetting.isPending ? 'Saving…' : 'Save PIN policy'}
        </Button>
      </div>
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
