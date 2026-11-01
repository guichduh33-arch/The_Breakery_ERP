import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useAutoDeviceSync } from './useAutoDeviceSync';

export function DeviceSyncMount(): null {
  const { pathname, search } = useLocation();
  const ready = useAuthStore((state) => state.isAuthenticated
    && state.bootstrapStatus === 'ready' && state.cloudValidated && !state.isLocked);
  // Le kiosk public conserve son polling dédié ; aucun token PIN ne lui est supposé.
  const publicKiosk = pathname.startsWith('/display')
    && !new URLSearchParams(search).has('source');
  useAutoDeviceSync(ready && !publicKiosk && pathname !== '/login');
  return null;
}
