// apps/backoffice/src/features/lan-devices/components/OfflineSettingsPanel.tsx
//
// ADR-015 — réglage du mode hors-ligne LAN (catégorie `network`, migration
// _252) : activation explicite de l'encaissement hors-ligne (défaut false).
// La fenêtre offline_max_hours a été supprimée — une coupure longue ne bloque
// plus la caisse. Rendu sur la page LAN Devices (section Network du hub
// Settings) ; lecture gatée settings.read, écriture settings.update — pattern
// SettingsInventoryPage.

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { formatTimeWita } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';

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
    return <div className="text-text-secondary text-sm">Access denied — you cannot read settings.</div>;
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
      setSaved(formatTimeWita(new Date()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  }

  return (
    <div className="space-y-4">
      {network.isLoading && <div className="text-text-secondary text-sm">Loading…</div>}
      {network.error && <div className="text-red text-sm">Failed to load: {network.error.message}</div>}

      {!network.isLoading && !network.error && draft !== null && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <label htmlFor="offline_payments_enabled" className="text-sm font-medium pt-2">
              Offline payments
            </label>
            <div className="md:col-span-2 space-y-1">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input className={FOCUS_RING}
                  id="offline_payments_enabled"
                  type="checkbox"
                  checked={draft.offlinePaymentsEnabled}
                  disabled={!canUpdate}
                  onChange={(e) => setDraft({ ...draft, offlinePaymentsEnabled: e.target.checked })}
                />
                <span>{draft.offlinePaymentsEnabled ? 'Enabled' : 'Disabled'}</span>
              </label>
              <p className="text-xs text-text-secondary">
                When the internet drops but the LAN hub still answers, the POS keeps
                taking payment — cash, card, QRIS, EDC, transfer and e-wallets. The EDC
                terminal uses its own SIM and does not need the shop network; the POS
                only records the settlement. Sales are queued locally and re-synced when
                the cloud comes back, with no cap on how long the outage lasts.
              </p>
              <p className="text-xs text-text-secondary">
                <strong>Exception:</strong> paying with store credit stays unavailable
                offline — only the server can check the balance.
              </p>
              <p className="text-xs text-text-secondary">
                Off by default — the owner turns it on explicitly.
              </p>
            </div>
          </div>

          {error && <p className="text-red text-sm" role="alert">{error}</p>}
          {savedAt && !dirty && <p className="text-success text-xs" role="status">Saved at {savedAt}</p>}

          {canUpdate && (
            <button type="submit" disabled={!dirty || setSetting.isPending} className={TOOLBAR_BTN_PRIMARY}>
              {setSetting.isPending ? 'Saving…' : dirty ? 'Save' : 'No changes'}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
