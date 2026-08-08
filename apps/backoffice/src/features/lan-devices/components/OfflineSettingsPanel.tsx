// apps/backoffice/src/features/lan-devices/components/OfflineSettingsPanel.tsx
//
// ADR-015 — réglage du mode hors-ligne LAN (catégorie `network`, migration
// _252) : activation explicite de l'encaissement hors-ligne (défaut false).
// La fenêtre offline_max_hours a été supprimée — une coupure longue ne bloque
// plus la caisse. Rendu sur la page LAN Devices (section Network du hub
// Settings) ; lecture gatée settings.read, écriture settings.update — pattern
// SettingsInventoryPage.

import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

interface Draft {
  offlinePaymentsEnabled: boolean;
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
      offlinePaymentsEnabled: Boolean(network.data.settings.offline_payments_enabled),
    });
  }, [network.data]);

  if (!canRead) {
    return <div className="text-text-secondary text-sm">Accès refusé aux réglages.</div>;
  }

  const original: Draft | null = network.data
    ? { offlinePaymentsEnabled: Boolean(network.data.settings.offline_payments_enabled) }
    : null;
  const dirty =
    draft !== null && original !== null
    && draft.offlinePaymentsEnabled !== original.offlinePaymentsEnabled;

  async function handleSave() {
    if (draft === null || original === null) return;
    setError(null);
    try {
      if (draft.offlinePaymentsEnabled !== original.offlinePaymentsEnabled) {
        await setSetting.mutateAsync({
          key: 'offline_payments_enabled', value: draft.offlinePaymentsEnabled, category: 'network',
        });
      }
      setSaved(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement");
    }
  }

  return (
    <div className="space-y-4">
      {network.isLoading && <div className="text-text-secondary text-sm">Loading…</div>}
      {network.error && <div className="text-red text-sm">Échec du chargement : {network.error.message}</div>}

      {!network.isLoading && !network.error && draft !== null && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <label htmlFor="offline_payments_enabled" className="text-sm font-medium pt-2">
              Encaissement hors-ligne
            </label>
            <div className="md:col-span-2 space-y-1">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input
                  id="offline_payments_enabled"
                  type="checkbox"
                  checked={draft.offlinePaymentsEnabled}
                  disabled={!canUpdate}
                  onChange={(e) => setDraft({ ...draft, offlinePaymentsEnabled: e.target.checked })}
                />
                <span>{draft.offlinePaymentsEnabled ? 'Activé' : 'Désactivé'}</span>
              </label>
              <p className="text-xs text-text-secondary">
                Quand internet tombe mais que le hub LAN répond, la caisse continue
                d&apos;encaisser — espèces, carte, QRIS, EDC, virement et e-wallets. Le
                terminal EDC passe par sa propre carte SIM et n&apos;a pas besoin du
                réseau de la boutique ; la caisse ne fait qu&apos;enregistrer le règlement.
                Les ventes sont journalisées localement et resynchronisées au retour du
                cloud, sans limite de durée de coupure.
              </p>
              <p className="text-xs text-text-secondary">
                <strong>Exception :</strong> le paiement par avoir client reste indisponible
                hors-ligne — son solde ne peut être vérifié que par le serveur.
              </p>
              <p className="text-xs text-text-secondary">
                Désactivé par défaut — activation explicite du propriétaire.
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
