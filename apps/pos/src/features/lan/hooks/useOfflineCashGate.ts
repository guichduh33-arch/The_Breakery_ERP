// apps/pos/src/features/lan/hooks/useOfflineCashGate.ts
//
// Spec 006x lot 4 — gate de l'encaissement CASH en mode OFFLINE :
//   * offline_cash_enabled (org, défaut false — activation explicite, A1b) ;
//   * fenêtre offline maximale offline_max_hours (défaut 4 h, A5) : au-delà,
//     bannière rouge et blocage des NOUVEAUX encaissements jusqu'au retour
//     du cloud. Les flux non-cash restent online-only quoi qu'il arrive.
//
// La fenêtre court depuis l'ENTRÉE en cloud-down (cloudStatusStore.offlineSince),
// pas depuis l'entrée en mode bus — un hub qui flappe ne remet pas le compteur.

import { useEffect, useState } from 'react';
import { useCloudStatusStore } from '../cloudStatusStore';
import { useOfflineMode } from '../offlineMode';
import { useOfflineNetworkConfig } from '@/features/settings/hooks/useOfflineNetworkConfig';

export type OfflineCashBlock = 'cash_disabled' | 'window_expired' | null;

export interface OfflineCashGate {
  /** Mode OFFLINE actif (cloud down + hub welcome). */
  offlineMode: boolean;
  /** Cash offline permis maintenant (mode actif, activé, fenêtre ouverte). */
  cashAllowed: boolean;
  /** Raison du blocage quand offlineMode && !cashAllowed. */
  blockedReason: OfflineCashBlock;
}

export function isWindowExpired(offlineSince: string | null, maxHours: number, now = Date.now()): boolean {
  if (offlineSince === null) return false;
  const started = Date.parse(offlineSince);
  if (Number.isNaN(started)) return false;
  return now - started > maxHours * 3_600_000;
}

export function useOfflineCashGate(): OfflineCashGate {
  const offlineMode = useOfflineMode();
  const offlineSince = useCloudStatusStore((s) => s.offlineSince);
  const { offlineCashEnabled, offlineMaxHours } = useOfflineNetworkConfig();

  // Re-render périodique pendant une coupure : l'expiration de fenêtre est un
  // événement TEMPS, pas un événement store — sans tick, la bannière rouge
  // n'apparaîtrait qu'au prochain render fortuit.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!offlineMode || offlineSince === null) return undefined;
    const handle = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(handle);
  }, [offlineMode, offlineSince]);

  if (!offlineMode) return { offlineMode: false, cashAllowed: false, blockedReason: null };
  if (!offlineCashEnabled) return { offlineMode: true, cashAllowed: false, blockedReason: 'cash_disabled' };
  if (isWindowExpired(offlineSince, offlineMaxHours)) {
    return { offlineMode: true, cashAllowed: false, blockedReason: 'window_expired' };
  }
  return { offlineMode: true, cashAllowed: true, blockedReason: null };
}
