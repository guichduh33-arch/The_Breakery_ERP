// apps/backoffice/src/features/lan-devices/components/OfflineSettingsPanel.tsx
//
// Spec 006x lot 4 — réglages du mode hors-ligne LAN (catégorie `network`,
// migration _197) : activation explicite du cash différé (A1b, défaut false)
// et fenêtre offline maximale en heures (A5, défaut 4). Rendu sur la page
// LAN Devices (section Network du hub Settings) ; lecture gatée settings.read,
// écriture settings.update — pattern SettingsInventoryPage.

import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

interface Draft {
  offlineCashEnabled: boolean;
  offlineMaxHours: number;
}

export function OfflineSettingsPanel() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const network = useSettings('network');
  const setSetting = useSetSetting();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!network.data) return;
    setDraft({
      offlineCashEnabled: Boolean(network.data.settings.offline_cash_enabled),
      offlineMaxHours: Number(network.data.settings.offline_max_hours ?? 4),
    });
  }, [network.data]);

  if (!canRead) {
    return <div className="text-text-secondary text-sm">Accès refusé aux réglages.</div>;
  }

  const original: Draft | null = network.data
    ? {
        offlineCashEnabled: Boolean(network.data.settings.offline_cash_enabled),
        offlineMaxHours: Number(network.data.settings.offline_max_hours ?? 4),
      }
    : null;
  const dirty =
    draft !== null && original !== null
    && (draft.offlineCashEnabled !== original.offlineCashEnabled
      || draft.offlineMaxHours !== original.offlineMaxHours);

  async function handleSave() {
    if (draft === null || original === null) return;
    setError(null);
    try {
      // Une mutation par clé changée — une entrée d'audit par champ.
      if (draft.offlineCashEnabled !== original.offlineCashEnabled) {
        await setSetting.mutateAsync({
          key: 'offline_cash_enabled', value: draft.offlineCashEnabled, category: 'network',
        });
      }
      if (draft.offlineMaxHours !== original.offlineMaxHours) {
        await setSetting.mutateAsync({
          key: 'offline_max_hours', value: draft.offlineMaxHours, category: 'network',
        });
      }
      setSaved(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement");
    }
  }

  return (
    <div className="space-y-4">
      {network.isLoading && <div className="text-text-secondary text-sm">Chargement…</div>}
      {network.error && <div className="text-red text-sm">Échec du chargement : {network.error.message}</div>}

      {!network.isLoading && !network.error && draft !== null && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <label htmlFor="offline_cash_enabled" className="text-sm font-medium pt-2">
              Encaissement cash hors-ligne
            </label>
            <div className="md:col-span-2 space-y-1">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input
                  id="offline_cash_enabled"
                  type="checkbox"
                  checked={draft.offlineCashEnabled}
                  disabled={!canUpdate}
                  onChange={(e) => setDraft({ ...draft, offlineCashEnabled: e.target.checked })}
                />
                <span>{draft.offlineCashEnabled ? 'Activé' : 'Désactivé'}</span>
              </label>
              <p className="text-xs text-text-secondary">
                Quand internet tombe mais que le hub LAN répond, la caisse peut encaisser
                en CASH ; la vente est journalisée localement et resynchronisée au retour
                du cloud. Désactivé par défaut — activation explicite du propriétaire.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <label htmlFor="offline_max_hours" className="text-sm font-medium pt-2">
              Fenêtre hors-ligne maximale (heures)
            </label>
            <div className="md:col-span-2 space-y-1">
              <input
                id="offline_max_hours"
                type="number"
                min={1}
                max={24}
                step={1}
                value={draft.offlineMaxHours}
                disabled={!canUpdate}
                onChange={(e) => setDraft({ ...draft, offlineMaxHours: Number(e.target.value) })}
                className="w-24 rounded-md bg-bg-input border border-border-subtle px-2 py-1.5 text-sm"
              />
              <p className="text-xs text-text-secondary">
                Au-delà de cette durée de coupure, la caisse bloque les nouveaux
                encaissements cash jusqu&apos;au retour du cloud (bannière rouge).
              </p>
            </div>
          </div>

          {error && <p className="text-red text-sm" role="alert">{error}</p>}
          {savedAt && !dirty && <p className="text-success text-xs" role="status">Enregistré à {savedAt}</p>}

          {canUpdate && (
            <Button type="submit" variant="primary" disabled={!dirty || setSetting.isPending}>
              {setSetting.isPending ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Aucun changement'}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
