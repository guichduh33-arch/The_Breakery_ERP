import { Stat } from '@breakery/ui';

// Direction horizontale (défaut) — la barre de statut / sidebar POS :
// label à gauche, valeur mono à droite, même baseline.
export const Horizontal = () => (
  <div className="max-w-xs space-y-3 rounded-lg bg-bg-base p-6">
    <Stat label="Commandes actives" value="12" />
    <Stat label="Tables occupées" value="6 / 14" />
    <Stat label="Tiroir-caisse" value="Rp 2,150,000" emphasis="gold" />
    <Stat label="Shift ouvert" value="06:30" />
  </div>
);

// Direction verticale — rangée de faits sous une carte produit / en-tête BO.
export const Vertical = () => (
  <div className="flex gap-10 rounded-lg bg-bg-base p-6">
    <Stat direction="vertical" label="CA du jour" value="Rp 4,850,000" emphasis="gold" />
    <Stat direction="vertical" label="Commandes" value="142" />
    <Stat direction="vertical" label="Panier moyen" value="Rp 74,500" />
    <Stat direction="vertical" label="Clients fidélité" value="96" />
  </div>
);

// Les deux directions sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice flex gap-12 rounded-lg bg-bg-base p-6">
    <div className="w-80 space-y-3">
      <Stat label="Factures B2B ouvertes" value="8" />
      <Stat label="Encours crédit" value="Rp 12,400,000" emphasis="gold" />
      <Stat label="Stock bas" value="5 articles" />
    </div>
    <div className="flex gap-10">
      <Stat direction="vertical" label="Ventes semaine" value="Rp 31,200,000" />
      <Stat direction="vertical" label="Marge brute" value="62%" emphasis="gold" />
    </div>
  </div>
);
