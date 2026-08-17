import { Skeleton } from '@breakery/ui';

// Les trois formes : line (texte), block (carte), circle (avatar).
export const Variants = () => (
  <div className="grid max-w-sm gap-4 bg-bg-base p-6">
    <Skeleton variant="line" width="60%" />
    <Skeleton variant="line" width="85%" />
    <Skeleton variant="line" width="40%" />
    <Skeleton variant="block" height={96} />
    <Skeleton variant="circle" width={48} height={48} />
  </div>
);

// La silhouette d'une carte commande pendant le chargement (motif DataTable).
export const OrderCardLoading = () => (
  <div className="bg-bg-base p-6">
    <div
      aria-busy="true"
      className="max-w-sm space-y-3 rounded-lg border border-border-subtle bg-bg-elevated p-4"
    >
      <div className="flex items-center justify-between">
        <Skeleton variant="line" width={120} />
        <Skeleton variant="line" width={56} />
      </div>
      <Skeleton variant="line" width="70%" />
      <div className="space-y-2 border-t border-border-subtle pt-3">
        <div className="flex justify-between">
          <Skeleton variant="line" width={140} />
          <Skeleton variant="line" width={64} />
        </div>
        <div className="flex justify-between">
          <Skeleton variant="line" width={110} />
          <Skeleton variant="line" width={64} />
        </div>
      </div>
      <Skeleton variant="block" height={44} />
    </div>
  </div>
);

// Rangée KPI du back-office en cours de chargement (thème ivoire).
export const Backoffice = () => (
  <div className="theme-backoffice grid grid-cols-3 gap-4 bg-bg-base p-6">
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        aria-busy="true"
        className="space-y-3 rounded-lg border border-border-subtle bg-bg-elevated p-4"
      >
        <Skeleton variant="line" width="50%" />
        <Skeleton variant="line" width="75%" height={28} />
        <Skeleton variant="line" width="35%" />
      </div>
    ))}
  </div>
);
