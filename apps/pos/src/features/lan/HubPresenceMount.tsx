// apps/pos/src/features/lan/HubPresenceMount.tsx
//
// Diagnostic 2026-08-25 — effet observateur : la présence sur le bus LAN était
// montée PAR PAGE (Pos, Kds, TabletLayout). Naviguer vers n'importe quel
// satellite (/pos/settings en tête) démontait le hook, fermait le socket et
// faisait quitter le bus au terminal — le panneau Hub des Settings se montrait
// donc toujours vide depuis le terminal qu'on regarde. La présence est un
// attribut du TERMINAL connecté, pas de l'écran affiché : elle se monte une
// fois, au shell (App.tsx, même famille que IdleTimeoutMount).
//
// /display reste exclu : la surface kiosk est publique (JWT kiosk, pas de
// session PIN) et porte sa propre présence avec le repli sur le code
// d'appairage (CustomerDisplayPage).
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { useLanHeartbeat } from './hooks/useLanHeartbeat';
import { useHubPresence } from './hooks/useHubPresence';

/** `device_type` déclaré au hello — dérivé de la surface active du terminal. */
function deviceTypeForPath(pathname: string): string {
  if (pathname.startsWith('/kds')) return 'kds';
  if (pathname.startsWith('/tablet')) return 'tablet';
  return 'pos';
}

export function HubPresenceMount(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { pathname } = useLocation();
  const deviceCode = usePosSettingsStore((s) => s.deviceCode);
  const deviceType = deviceTypeForPath(pathname);
  const enabled = isAuthenticated && !pathname.startsWith('/display');
  useLanHeartbeat({ deviceCode, deviceType, enabled });
  useHubPresence({ deviceCode, deviceType, enabled });
  return null;
}
