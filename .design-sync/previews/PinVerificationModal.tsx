import { PinVerificationModal } from '@breakery/ui';
import { useEffect } from 'react';

// Rejoue 4 frappes sur le pavé (aria-label des touches) pour montrer les
// points PIN partiellement remplis — un clic par tick pour laisser React
// flusher l'état entre deux touches.
function AutoKeys({ labels }: { labels: string[] }) {
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      const label = labels[i++];
      if (label === undefined) {
        clearInterval(t);
        return;
      }
      const btn = document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
      btn?.click();
    }, 60);
    return () => clearInterval(t);
  }, []);
  return null;
}

// Vérification PIN manager en cours de saisie (4/6 chiffres) — le flux
// d'autorisation d'une remise au POS.
export const Open = () => (
  <div className="fixed inset-0 bg-bg-base">
    <AutoKeys labels={['2', '6', '0', '8']} />
    <PinVerificationModal
      open
      onClose={() => {}}
      onVerified={() => {}}
      requiredPermission="sales.discount"
      verifyFn={async () => ({ ok: true as const, userId: 'manager-1' })}
    />
  </div>
);
