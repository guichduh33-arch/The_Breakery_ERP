// apps/pos/src/lib/nativeShell.ts
//
// Adaptateur unique vers la coquille Capacitor (ADR-029, arbitrage 2 : les
// capacités natives passent par des adaptateurs isolés, jamais par des
// branches dans les composants). Sur le web, isNativePlatform() rend false
// et tout le reste du code ignore la coquille.
import { Capacitor } from '@capacitor/core';

/** Vrai quand le bundle tourne dans la coquille native (tablette de salle). */
export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}
