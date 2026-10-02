import { useAuthStore } from '@/stores/authStore';
import { useCloudStatusStore } from '../cloudStatusStore';

/** Une coupure WAN conserve navigator.onLine=true : seule la sonde cloud fait foi. */
export function useSaleQueryEnabled(enabled = true): boolean {
  const cloudOnline = useCloudStatusStore((state) => state.cloudOnline);
  const suspended = useAuthStore((state) => state.isAuthenticated && !state.cloudValidated);
  return enabled && cloudOnline && !suspended;
}
