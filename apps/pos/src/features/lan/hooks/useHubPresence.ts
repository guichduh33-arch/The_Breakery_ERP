// apps/pos/src/features/lan/hooks/useHubPresence.ts
//
// Spec 006x lot 1 — client PRESENCE-ONLY du hub LAN (ws://<bridge>/ws).
// Se connecte au hub, envoie le hello (device_code + token per-terminal) puis
// un heartbeat sur le bus toutes les 10 s ; reconnexion en backoff exponentiel.
// Aucun flux métier ne passe par le bus en lot 1 — ce hook sert à valider la
// connectivité (mixed-content compris) et à alimenter le panneau BO « Hub ».
// Lot 2 : publie l'état de connexion dans useHubConnectionStore (welcome →
// connected) — useLanHeartbeat se tait tant que le hub est l'écrivain cloud.

import { useEffect } from 'react';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { getPrintServerUrl } from '@/services/print/printService';
import { useHubConnectionStore } from '../hubConnectionStore';

const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

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

export function useHubPresence({ deviceCode, deviceType, enabled = true }: UseHubPresenceOptions): void {
  const hubToken = usePosSettingsStore((s) => s.hubToken);

  useEffect(() => {
    if (!enabled) return;
    if (deviceCode === '') return;
    // jsdom / anciens WebView : pas de WebSocket → hook inerte.
    if (typeof WebSocket === 'undefined') return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let heartbeatHandle: number | null = null;
    let reconnectHandle: number | null = null;
    let backoffMs = RECONNECT_MIN_MS;

    function clearHeartbeat(): void {
      if (heartbeatHandle !== null) {
        window.clearInterval(heartbeatHandle);
        heartbeatHandle = null;
      }
    }

    function scheduleReconnect(): void {
      if (disposed) return;
      reconnectHandle = window.setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
    }

    function connect(): void {
      if (disposed) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(hubWsUrl(getPrintServerUrl()));
      } catch {
        scheduleReconnect();
        return;
      }
      ws = socket;

      socket.onopen = () => {
        backoffMs = RECONNECT_MIN_MS;
        socket.send(JSON.stringify({
          type: 'hello',
          device_code: deviceCode,
          device_type: deviceType,
          ...(hubToken !== '' ? { token: hubToken } : {}),
        }));
        socket.onmessage = (event: MessageEvent<string>) => {
          // `connected` ne bascule qu'au welcome (hello accepté), pas à
          // l'open : un hello refusé (4003) ne doit jamais couper le
          // fallback heartbeat direct de useLanHeartbeat.
          try {
            const msg = JSON.parse(event.data) as { type?: string };
            if (msg.type === 'welcome') useHubConnectionStore.getState().setConnected(true);
          } catch { /* messages non-JSON ignorés */ }
        };
        heartbeatHandle = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              v: 1,
              msg_id: crypto.randomUUID(),
              device_code: deviceCode,
              ts: new Date().toISOString(),
              topic: 'presence.heartbeat',
              payload: { device_type: deviceType },
            }));
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      socket.onclose = () => {
        useHubConnectionStore.getState().setConnected(false);
        clearHeartbeat();
        scheduleReconnect();
      };
      socket.onerror = () => { /* onclose suit toujours */ };
    }

    connect();

    return () => {
      disposed = true;
      clearHeartbeat();
      if (reconnectHandle !== null) window.clearTimeout(reconnectHandle);
      ws?.close();
      useHubConnectionStore.getState().setConnected(false);
    };
  }, [deviceCode, deviceType, enabled, hubToken]);
}
