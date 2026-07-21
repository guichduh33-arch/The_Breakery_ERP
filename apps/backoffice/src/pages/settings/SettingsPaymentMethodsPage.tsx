// apps/backoffice/src/pages/settings/SettingsPaymentMethodsPage.tsx
// S64 (fiche 19 D2.1) — active/désactive les moyens de paiement présentés au POS.
// Écrit business_config.enabled_payment_methods via set_setting_v5 (audité old/new).

import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

const ALL_METHODS = [
  { value: 'cash',         label: 'Cash' },
  { value: 'card',         label: 'Card' },
  { value: 'qris',         label: 'QRIS' },
  { value: 'edc',          label: 'EDC' },
  { value: 'transfer',     label: 'Transfer' },
  { value: 'store_credit', label: 'Store Credit' },
] as const;

export default function SettingsPaymentMethodsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const payments   = useSettings('payments');
  const setSetting = useSetSetting();

  const [draft, setDraft]   = useState<string[] | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [savedAt, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!payments.data) return;
    const raw = payments.data.settings.enabled_payment_methods;
    setDraft(Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : ALL_METHODS.map((m) => m.value));
  }, [payments.data]);

  if (!canRead) {
    return <div className="text-text-secondary">Accès refusé aux réglages.</div>;
  }

  // Save (dirty) exige un `original` array — garanti aujourd'hui par le
  // NOT NULL + CHECK array non vide de business_config.enabled_payment_methods.
  const original = payments.data && Array.isArray(payments.data.settings.enabled_payment_methods)
    ? (payments.data.settings.enabled_payment_methods as string[])
    : null;
  const dirty = draft !== null && original !== null
    && (draft.length !== original.length || draft.some((m) => !original.includes(m)));
  const empty = draft !== null && draft.length === 0;

  function toggle(value: string, checked: boolean) {
    setDraft((prev) => {
      if (prev === null) return prev;
      return checked ? [...prev, value] : prev.filter((m) => m !== value);
    });
  }

  async function handleSave() {
    if (draft === null || draft.length === 0) return;
    setError(null);
    try {
      // Ordre canonique stable (évite un dirty fantôme par réordonnancement).
      const ordered = ALL_METHODS.map((m) => m.value).filter((v) => draft.includes(v));
      await setSetting.mutateAsync({ key: 'enabled_payment_methods', value: ordered, category: 'payments' });
      setSaved(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement");
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl">Moyens de paiement</h1>
        <p className="text-text-secondary text-sm mt-1">
          Les méthodes décochées disparaissent des terminaux POS (≤ 60 s, sans redémarrage).
          Chaque changement écrit une entrée d&apos;audit.
        </p>
      </div>

      {payments.isLoading && <div className="text-text-secondary">Chargement…</div>}
      {payments.error && <div className="text-red">Échec du chargement : {payments.error.message}</div>}

      {!payments.isLoading && !payments.error && draft !== null && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="space-y-3">
            {ALL_METHODS.map((m) => (
              <label key={m.value} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.includes(m.value)}
                  disabled={!canUpdate}
                  onChange={(e) => toggle(m.value, e.target.checked)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>

          {empty && <p className="text-red text-sm" role="alert">Au moins une méthode doit rester activée.</p>}
          {error && <p className="text-red text-sm" role="alert">{error}</p>}
          {savedAt && !dirty && <p className="text-success text-xs" role="status">Enregistré à {savedAt}</p>}

          {canUpdate && (
            <Button type="submit" variant="primary" disabled={!dirty || empty || setSetting.isPending}>
              {setSetting.isPending ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Aucun changement'}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
