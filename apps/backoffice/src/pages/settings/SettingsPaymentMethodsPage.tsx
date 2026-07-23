// apps/backoffice/src/pages/settings/SettingsPaymentMethodsPage.tsx
// S64 (fiche 19 D2.1) — active/désactive les moyens de paiement présentés au POS.
// Écrit business_config.enabled_payment_methods via set_setting_v5 (audité old/new).
//
// ADR-006 déc. 9 (lot A) — l'ORDRE de l'array est désormais contractuel : c'est
// l'ordre d'affichage des grilles POS. Flèches monter/descendre sur les méthodes
// activées ; cocher ajoute en fin de liste, décocher retire.

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
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

const LABELS = new Map<string, string>(ALL_METHODS.map((m) => [m.value, m.label]));

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
  // Comparaison sensible à l'ORDRE (lot A) — un pur réordonnancement est un
  // vrai changement à enregistrer.
  const dirty = draft !== null && original !== null
    && (draft.length !== original.length || draft.some((m, i) => m !== original[i]));
  const empty = draft !== null && draft.length === 0;

  const disabledMethods = ALL_METHODS.filter((m) => draft !== null && !draft.includes(m.value));

  function toggle(value: string, checked: boolean) {
    setDraft((prev) => {
      if (prev === null) return prev;
      return checked ? [...prev, value] : prev.filter((m) => m !== value);
    });
  }

  function move(index: number, delta: -1 | 1) {
    setDraft((prev) => {
      if (prev === null) return prev;
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function handleSave() {
    if (draft === null || draft.length === 0) return;
    setError(null);
    try {
      // L'ordre du draft EST l'ordre d'affichage POS — envoyé tel quel.
      await setSetting.mutateAsync({ key: 'enabled_payment_methods', value: draft, category: 'payments' });
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
          Les méthodes décochées disparaissent des terminaux POS (≤ 60 s, sans redémarrage) ;
          l&apos;ordre ci-dessous est l&apos;ordre d&apos;affichage sur les grilles POS.
          Chaque changement écrit une entrée d&apos;audit.
        </p>
      </div>

      {payments.isLoading && <div className="text-text-secondary">Chargement…</div>}
      {payments.error && <div className="text-red">Échec du chargement : {payments.error.message}</div>}

      {!payments.isLoading && !payments.error && draft !== null && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="space-y-3">
            {draft.map((value, i) => (
              <div key={value} className="flex items-center gap-3 text-sm" data-testid={`pm-row-${value}`}>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked
                    disabled={!canUpdate}
                    onChange={(e) => toggle(value, e.target.checked)}
                  />
                  <span>{LABELS.get(value) ?? value}</span>
                </label>
                {canUpdate && (
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      aria-label={`Monter ${LABELS.get(value) ?? value}`}
                      data-testid={`pm-up-${value}`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="rounded p-1 text-text-secondary hover:text-text-primary disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Descendre ${LABELS.get(value) ?? value}`}
                      data-testid={`pm-down-${value}`}
                      disabled={i === draft.length - 1}
                      onClick={() => move(i, 1)}
                      className="rounded p-1 text-text-secondary hover:text-text-primary disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </button>
                  </span>
                )}
              </div>
            ))}
            {disabledMethods.length > 0 && (
              <div className="space-y-3 border-t border-border-subtle pt-3">
                {disabledMethods.map((m) => (
                  <label key={m.value} className="flex items-center gap-3 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={!canUpdate}
                      onChange={(e) => toggle(m.value, e.target.checked)}
                    />
                    <span>{m.label}</span>
                  </label>
                ))}
              </div>
            )}
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
