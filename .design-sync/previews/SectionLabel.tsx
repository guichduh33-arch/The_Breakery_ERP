import { SectionLabel } from '@breakery/ui';

// La signature Luxe Bakery : MAJUSCULES + tracking-widest. Deux tailles —
// xs 11px (groupes sidebar, labels KPI) et sm 13px (titres de section).
export const Sizes = () => (
  <div className="flex flex-col gap-6 bg-bg-base p-6">
    <div className="flex items-baseline gap-4">
      <SectionLabel size="xs">Active order</SectionLabel>
      <span className="text-xs text-text-subtle">xs — 11px</span>
    </div>
    <div className="flex items-baseline gap-4">
      <SectionLabel size="sm">Top produits du jour</SectionLabel>
      <span className="text-xs text-text-subtle">sm — 13px</span>
    </div>
  </div>
);

// En contexte : tête de section au-dessus d'un contenu réel (panneau POS).
export const InContext = () => (
  <div className="max-w-xs space-y-3 rounded-lg bg-bg-base p-6">
    <SectionLabel as="h3" size="xs">Commande active</SectionLabel>
    <ul className="space-y-2 text-sm text-text-primary">
      <li className="flex justify-between"><span>2 × Croissant beurre</span><span className="font-mono tabular-nums">Rp 36,000</span></li>
      <li className="flex justify-between"><span>1 × Pain au chocolat</span><span className="font-mono tabular-nums">Rp 20,000</span></li>
    </ul>
    <SectionLabel as="h3" size="xs" className="pt-2">Operations</SectionLabel>
    <p className="text-sm text-text-secondary">Shift ouvert — caisse 1 · 06:30</p>
  </div>
);

// Sous le thème ivoire BO (groupes de la sidebar, labels de tuiles KPI).
export const Backoffice = () => (
  <div className="theme-backoffice flex flex-col gap-6 bg-bg-base p-6">
    <div className="flex items-baseline gap-4">
      <SectionLabel size="xs">Today's revenue</SectionLabel>
      <span className="text-xs text-text-subtle">xs — 11px</span>
    </div>
    <div className="flex items-baseline gap-4">
      <SectionLabel as="h2" size="sm">Inventaire</SectionLabel>
      <span className="text-xs text-text-subtle">sm — 13px</span>
    </div>
  </div>
);
