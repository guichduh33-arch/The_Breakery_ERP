// apps/backoffice/src/features/loyalty/hooks/useMintLoyaltyPointsAuthorization.ts
// Décision 2026-11-21 — nonce PIN manager (scope loyalty_points_grant,
// permission loyalty.adjust, usage unique, TTL 60 s) pour AJOUTER des points.
// Même véhicule que le grant d'avoir : header x-manager-pin vers
// verify-manager-pin, nonce consommé par adjust_loyalty_points_v4.

import { mintManagerAuthorization } from '../../customers/hooks/useMintStoreCreditAuthorization.js';

export function mintLoyaltyPointsAuthorization(managerPin: string): Promise<string> {
  return mintManagerAuthorization('loyalty_points_grant', managerPin);
}
