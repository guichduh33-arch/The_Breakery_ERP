import { Toaster } from '@breakery/ui';
import { useEffect } from 'react';
import { toast } from 'sonner';

// Rendu statique : trois toasts persistants (duration Infinity) empilés en
// expand, montés au premier rendu via useEffect. L'<ol> sonner est
// position:fixed (hors de la boîte capturée) : on le ré-ancre en absolute
// dans un wrapper relative — "toaster group" est repassé car Toast.tsx
// remplace sa className par la nôtre (spread après).
//
// ⚠ BLOQUÉ PAR LA CONFIG DU SYNC (voir learnings/wave-A-primitives.md) :
// le Toaster du kit vit dans _ds_bundle.js avec SA copie de sonner, tandis
// que `import { toast } from 'sonner'` ci-dessous est bundlé À PART dans le
// module d'aperçu — deux singletons ToastState disjoints, le Toaster ne voit
// jamais ces toasts et rend null. Débloquer = cfg.extraEntries: ["sonner"]
// (ou ré-exporter `toast` depuis @breakery/ui), puis ce fichier marche tel quel.
export const Notifications = () => {
  useEffect(() => {
    toast.error('Imprimante ticket hors ligne', { duration: Infinity });
    toast('Commande #1042 envoyée en cuisine', {
      description: 'Sur place — Table 4',
      duration: Infinity,
    });
    toast.success('Paiement encaissé — Rp 68,000', { duration: Infinity });
  }, []);
  return (
    <div className="relative h-80 w-full overflow-hidden bg-bg-base">
      <Toaster
        position="bottom-right"
        expand
        visibleToasts={3}
        className="toaster group !absolute"
      />
    </div>
  );
};
