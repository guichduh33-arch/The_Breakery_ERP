import { IdleWarningToast } from '@breakery/ui';
import { useEffect } from 'react';

// Le toast est piloté par événements (CustomEvent `idle:warning` émis par
// useIdleTimeout 30 s avant déconnexion) et rend null au repos. Ce déclencheur
// émet l'événement après montage pour figer l'état visible.
const FireWarning = () => {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('idle:warning'));
  }, []);
  return null;
};

// Les classes par défaut posent le toast en `fixed top-4 right-4` (il
// s'échapperait de la carte) : la prop className REMPLACE tout le style — on
// reprend donc les classes du composant sans le positionnement fixe.
const STATIC_TOAST =
  'flex items-center gap-3 rounded border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning shadow-lg';

// Bannière d'avertissement telle qu'elle apparaît sur le POS luxe-dark,
// compte à rebours + bouton « Stay signed in » (émet idle:reset).
export const Warning = () => (
  <div className="flex flex-col items-start gap-3 bg-bg-base p-6">
    <IdleWarningToast className={STATIC_TOAST} />
    <FireWarning />
    <p className="text-xs text-text-muted">
      Position réelle : fixed top-4 right-4 — neutralisée ici pour rester dans la carte.
    </p>
  </div>
);

// Même bannière sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice flex flex-col items-start gap-3 bg-bg-base p-6">
    <IdleWarningToast className={STATIC_TOAST} />
    <FireWarning />
  </div>
);
