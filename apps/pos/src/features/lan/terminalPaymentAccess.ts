import { isNativeShell } from '@/lib/nativeShell';
import { useLanCredential } from './lanCredential';

// Le type vient de l'appairage, jamais de l'URL ou du rôle de l'employé.
// La coquille Android est une tablette de salle (ADR-029).
function orderingOnly(deviceType: string | undefined): boolean {
  return deviceType === 'tablet' || deviceType === 'kds' || isNativeShell();
}

export function useOrderingOnlyTerminal(): boolean {
  const type = useLanCredential((state) => state.credential?.device_type);
  return orderingOnly(type);
}

export function assertTerminalPaymentAllowed(): void {
  if (orderingOnly(useLanCredential.getState().credential?.device_type)) {
    throw Object.assign(new Error('Payments are only available at the cashier.'), {
      details: { error: 'terminal_payment_forbidden' },
    });
  }
}
