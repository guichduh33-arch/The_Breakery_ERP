import { Separator } from '@breakery/ui';

// Horizontal : sépare les blocs d'un ticket / panneau.
export const Horizontal = () => (
  <div className="max-w-sm bg-bg-base p-6">
    <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4 text-sm">
      <p className="font-semibold text-text-primary">Commande #1042</p>
      <p className="text-text-secondary">Sur place — Table 4 · 14:32</p>
      <Separator className="my-3" />
      <div className="flex justify-between text-text-secondary">
        <span>2 × Croissant beurre</span>
        <span className="font-mono tabular-nums">Rp 36,000</span>
      </div>
      <div className="flex justify-between text-text-secondary">
        <span>1 × Latte</span>
        <span className="font-mono tabular-nums">Rp 32,000</span>
      </div>
      <Separator className="my-3" />
      <div className="flex justify-between font-semibold text-text-primary">
        <span>Total</span>
        <span className="font-mono tabular-nums">Rp 68,000</span>
      </div>
    </div>
  </div>
);

// Vertical : sépare les métadonnées d'une même ligne.
export const Vertical = () => (
  <div className="bg-bg-base p-6">
    <div className="flex h-5 items-center gap-3 text-sm text-text-secondary">
      <span className="font-semibold text-text-primary">Shift du matin</span>
      <Separator orientation="vertical" />
      <span>Caisse 1</span>
      <Separator orientation="vertical" />
      <span>Ouvert 06:30</span>
      <Separator orientation="vertical" />
      <span className="font-mono tabular-nums">57 commandes</span>
    </div>
  </div>
);

// Sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice max-w-sm bg-bg-base p-6">
    <div className="text-sm">
      <p className="font-semibold text-text-primary">Rapport des ventes</p>
      <p className="text-text-secondary">Dimanche 17 août</p>
      <Separator className="my-3" />
      <div className="flex justify-between text-text-secondary">
        <span>Chiffre d'affaires</span>
        <span className="font-mono tabular-nums">Rp 4,850,000</span>
      </div>
      <div className="flex justify-between text-text-secondary">
        <span>Panier moyen</span>
        <span className="font-mono tabular-nums">Rp 74,500</span>
      </div>
    </div>
  </div>
);
