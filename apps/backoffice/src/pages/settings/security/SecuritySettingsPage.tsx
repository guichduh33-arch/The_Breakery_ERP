// apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx
//
// ADR-006 déc. 9 (PIN policy) — politique de verrouillage du PIN
// (pin_max_failed 3-10, pin_lockout_minutes 5-120, catégorie settings
// `security`, lue par l'EF auth-verify-pin à chaque login).
//
// ADR-031 — la table des délais d'inactivité PAR RÔLE a quitté cette page :
// c'est un attribut du rôle, il vit maintenant dans la fiche du rôle
// (`/backoffice/settings/roles/:roleCode`) à côté de ses permissions. Ce qui
// reste ici est la seule politique VRAIMENT globale du login.
//
// Route access is gated by settings.security.manage (routes/index.tsx);
// editing is gated by settings.update (mirrors the RPC gate).

import { useEffect, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export default function SecuritySettingsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('settings.update');

  return (
    <div className="space-y-6">
      <PageHeader
        title="PIN policy"
        subtitle={
          <>
            Login PIN lockout, applied on every sign-in attempt. Changes are
            audit-logged. Per-role idle timeouts live on each role&apos;s page.
            {!canEdit && (
              <span className="mt-2 block text-xs italic">
                Read-only view — the <code>settings.update</code> permission is
                required to edit.
              </span>
            )}
          </>
        }
      />

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
        <h2 className="text-xl">Lockout</h2>
        <p className="text-text-secondary text-sm mt-1">
          After the configured number of failed attempts, the account locks for
          the configured duration.
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
              className={`w-24 rounded-md border border-border-strong bg-bg-input px-2 py-1 text-sm ${FOCUS_RING}`}
            />
            <span className="text-xs text-text-muted">{f.hint}</span>
            {invalid && (
              <span className="text-xs text-danger-as-text" data-testid={`pin-invalid-${f.key}`}>
                Out of bounds.
              </span>
            )}
          </div>
        ))}
        <button
          type="button"
          className={TOOLBAR_BTN_PRIMARY}
          onClick={handleSave}
          disabled={!canEdit || anyInvalid || !anyDirty || setSetting.isPending}
          data-testid="pin-policy-save"
        >
          {setSetting.isPending ? 'Saving…' : 'Save PIN policy'}
        </button>
      </div>
    </div>
  );
}
