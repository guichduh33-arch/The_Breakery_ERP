import { RedeemPointsModal } from '@breakery/ui';
import { useEffect } from 'react';

// Rejoue « 5 0 0 » sur le pavé numérique (un clic par tick pour laisser React
// flusher l'état) : 500 points saisis = Rp 5.000 de valeur, état valide.
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

// Client fidélité avec 2 500 pts : rachat de 500 points sur un panier de
// Rp 150,000 — saisie valide, Confirm actif.
export const Open = () => (
  <div className="fixed inset-0 bg-bg-base">
    <AutoKeys labels={['5', '0', '0']} />
    <RedeemPointsModal
      open
      onClose={() => {}}
      onConfirm={() => {}}
      customerBalance={2500}
      itemsTotal={150000}
    />
  </div>
);
