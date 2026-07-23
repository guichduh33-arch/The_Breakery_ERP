// apps/backoffice/src/pages/settings/SettingsPaymentMethodsPage.tsx
// S64 (fiche 19 D2.1) — active/désactive les moyens de paiement présentés au POS.
// Écrit business_config.enabled_payment_methods via set_setting_v7 (audité old/new).
//
// ADR-006 déc. 9 (lot A) — l'ORDRE de l'array est désormais contractuel : c'est
// l'ordre d'affichage des grilles POS. Flèches monter/descendre sur les méthodes
// activées ; cocher ajoute en fin de liste, décocher retire.
//
// ADR-006 déc. 9 (lot C) — frais informatifs par méthode (% seul) : écrits dans
// business_config.payment_method_fees, servent au net estimé du rapport
// Payments by Method. Aucun impact money-path (pas de JE automatique).

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
  // Lot B (ADR-006 déc. 9) — e-wallets individuels, settlement type QRIS
  // (mapping comptable + bucket de réconciliation shift).
  { value: 'gopay',        label: 'GoPay' },
  { value: 'ovo',          label: 'OVO' },
  { value: 'dana',         label: 'DANA' },
] as const;

const LABELS = new Map<string, string>(ALL_METHODS.map((m) => [m.value, m.label]));

function parseFees(raw: unknown): Record<string, number> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// Draft inputs (strings) → objet à persister : clés non vides, valeurs numériques.
function feesFromDraft(draft: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(draft)) {
    const t = v.trim();
    if (t === '') continue;
    out[k] = Number(t);
  }
  return out;
}

function sameFees(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] === a[k]);
}

export default function SettingsPaymentMethodsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const payments   = useSettings('payments');
  const setSetting = useSetSetting();

  const [draft, setDraft]         = useState<string[] | null>(null);
  const [feesDraft, setFeesDraft] = useState<Record<string, string> | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [savedAt, setSaved]       = useState<string | null>(null);

  useEffect(() => {
    if (!payments.data) return;
    const raw = payments.data.settings.enabled_payment_methods;
    setDraft(Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : ALL_METHODS.map((m) => m.value));
    const fees = parseFees(payments.data.settings.payment_method_fees);
    setFeesDraft(Object.fromEntries(
      ALL_METHODS.map((m) => [m.value, fees[m.value] !== undefined ? String(fees[m.value]) : '']),
    ));
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
  const methodsDirty = draft !== null && original !== null
    && (draft.length !== original.length || draft.some((m, i) => m !== original[i]));
  const empty = draft !== null && draft.length === 0;

  const originalFees = payments.data ? parseFees(payments.data.settings.payment_method_fees) : {};
  const feeInvalid = feesDraft !== null && Object.values(feesDraft).some((v) => {
    const t = v.trim();
    if (t === '') return false;
    const n = Number(t);
    return !Number.isFinite(n) || n < 0 || n > 100;
  });
  const feesDirty = feesDraft !== null && !feeInvalid
    && !sameFees(feesFromDraft(feesDraft), originalFees);

  const dirty = methodsDirty || feesDirty;

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

  function setFee(value: string, pct: string) {
    setFeesDraft((prev) => (prev === null ? prev : { ...prev, [value]: pct }));
  }

  function feeInput(value: string) {
    if (feesDraft === null) return null;
    return (
      <span className="flex items-center gap-1 text-xs text-text-secondary">
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={feesDraft[value] ?? ''}
          placeholder="0"
          disabled={!canUpdate}
          aria-label={`Frais ${LABELS.get(value) ?? value} (%)`}
          data-testid={`pm-fee-${value}`}
          onChange={(e) => setFee(value, e.target.value)}
          className="w-20 rounded border border-border-subtle bg-bg-input px-2 py-1 text-right text-sm"
        />
        %
      </span>
    );
  }

  async function handleSave() {
    if (draft === null || draft.length === 0 || feesDraft === null || feeInvalid) return;
    setError(null);
    try {
      if (methodsDirty) {
        // L'ordre du draft EST l'ordre d'affichage POS — envoyé tel quel.
        await setSetting.mutateAsync({ key: 'enabled_payment_methods', value: draft, category: 'payments' });
      }
      if (feesDirty) {
        await setSetting.mutateAsync({ key: 'payment_method_fees', value: feesFromDraft(feesDraft), category: 'payments' });
      }
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
          Le % de frais est informatif (net estimé dans le rapport Payments by Method),
          aucune écriture comptable automatique. Chaque changement écrit une entrée d&apos;audit.
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
                <span className="ml-auto flex items-center gap-3">
                  {feeInput(value)}
                  {canUpdate && (
                    <span className="flex gap-1">
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
                </span>
              </div>
            ))}
            {disabledMethods.length > 0 && (
              <div className="space-y-3 border-t border-border-subtle pt-3">
                {disabledMethods.map((m) => (
                  <div key={m.value} className="flex items-center gap-3 text-sm text-text-secondary">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={!canUpdate}
                        onChange={(e) => toggle(m.value, e.target.checked)}
                      />
                      <span>{m.label}</span>
                    </label>
                    <span className="ml-auto">{feeInput(m.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {empty && <p className="text-red text-sm" role="alert">Au moins une méthode doit rester activée.</p>}
          {feeInvalid && <p className="text-red text-sm" role="alert">Les frais doivent être un pourcentage entre 0 et 100.</p>}
          {error && <p className="text-red text-sm" role="alert">{error}</p>}
          {savedAt && !dirty && <p className="text-success text-xs" role="status">Enregistré à {savedAt}</p>}

          {canUpdate && (
            <Button type="submit" variant="primary" disabled={!dirty || empty || feeInvalid || setSetting.isPending}>
              {setSetting.isPending ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Aucun changement'}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
