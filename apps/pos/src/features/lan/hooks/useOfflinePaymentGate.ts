// apps/pos/src/features/lan/hooks/useOfflinePaymentGate.ts
//
// ADR-015 — gate de l'encaissement en mode OFFLINE. Un seul verrou subsiste :
// offline_payments_enabled (org, défaut false — activation explicite).
//
// La fenêtre offline_max_hours est SUPPRIMÉE : une coupure longue ne bloque
// plus la caisse. Le raisonnement est que l'argent, lui, continue d'entrer —
// l'EDC carte/QRIS porte sa propre SIM et ne dépend pas du réseau boutique, et
// le POS ne fait qu'enregistrer un règlement déjà encaissé ailleurs.
//
// Le choix des MÉTHODES autorisées ne vit pas ici mais au dispatch
// (usePaymentFlowLogic) : toutes sauf store_credit, dont le solde se vérifie
// serveur sous verrou et dont le replay peut être refusé.

import { useOfflineMode } from '../offlineMode';
import { useOfflineNetworkConfig } from '@/features/settings/hooks/useOfflineNetworkConfig';

export type OfflinePaymentBlock = 'payments_disabled' | null;

export interface OfflinePaymentGate {
  /** Mode OFFLINE actif (cloud down + hub welcome). */
  offlineMode: boolean;
  /** Encaissement offline permis maintenant (mode actif + réglage activé). */
  paymentsAllowed: boolean;
  /** Raison du blocage quand offlineMode && !paymentsAllowed. */
  blockedReason: OfflinePaymentBlock;
}

export function useOfflinePaymentGate(): OfflinePaymentGate {
  const offlineMode = useOfflineMode();
  const { offlinePaymentsEnabled } = useOfflineNetworkConfig();

  if (!offlineMode) return { offlineMode: false, paymentsAllowed: false, blockedReason: null };
  if (!offlinePaymentsEnabled) {
    return { offlineMode: true, paymentsAllowed: false, blockedReason: 'payments_disabled' };
  }
  return { offlineMode: true, paymentsAllowed: true, blockedReason: null };
}
