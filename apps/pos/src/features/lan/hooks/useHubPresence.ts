// apps/pos/src/features/lan/hooks/useHubPresence.ts
//
// Spec 006x lot 1 — présence sur le bus LAN (ws://<bridge>/ws).
// Lot 3 — le socket, le hello, le heartbeat et la reconnexion vivent
// désormais dans hubBusClient (singleton refcounté, partagé avec les flux
// métier order.fired / order.item_status). Ce hook ne fait plus que monter/
// démonter le client avec l'identité du terminal ; l'état `connected` est
// publié dans useHubConnectionStore par le client, AU WELCOME (lot 2 — un
// hello refusé ne coupe jamais le fallback heartbeat direct).

import { useEffect } from 'react';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { getPrintServerUrl } from '@/services/print/printService';
import { hubBus } from '../hubBusClient';
import { useLanCredential } from '../lanCredential';

/** `http(s)://host:port[/]` → `ws(s)://host:port/ws`. */
export function hubWsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`;
}

interface UseHubPresenceOptions {
  /** Device code (== `lan_devices.code`). '' = no-op. */
  deviceCode: string;
  deviceType: string;
  /** Disable in tests / E2E. */
  enabled?: boolean;
}

export function useHubPresence({
  deviceCode,
  deviceType,
  enabled = true,
}: UseHubPresenceOptions): void {
  const credential = useLanCredential((s) => s.credential);
  const printerUrl = usePosSettingsStore((s) => s.printerUrl);

  useEffect(() => {
    if (!enabled) return;
    if (!credential) return;
    // jsdom / anciens WebView : pas de WebSocket → hook inerte.
    if (typeof WebSocket === 'undefined') return;
    let url: string;
    try {
      url = hubWsUrl(getPrintServerUrl());
    } catch {
      return;
    }

    hubBus.start({
      url,
      deviceCode: credential.code,
      deviceType: credential.device_type,
      token: credential.secret,
    });
    return () => {
      hubBus.stop();
    };
  }, [deviceCode, deviceType, enabled, credential, printerUrl]);
}
