import { Input } from '@breakery/ui';

// États rendables : placeholder, rempli, numérique, désactivé.
export const States = () => (
  <div className="grid max-w-sm gap-4 bg-bg-base p-6">
    <Input placeholder="Rechercher un produit…" />
    <Input value="Croissant beurre" onChange={() => {}} />
    <Input
      type="number"
      value="36000"
      onChange={() => {}}
      className="font-mono tabular-nums"
    />
    <Input value="Baguette tradition" onChange={() => {}} disabled />
  </div>
);

// Même famille sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice grid max-w-sm gap-4 bg-bg-base p-6">
    <Input placeholder="Nom du fournisseur…" />
    <Input value="Boulangerie Pak Wayan" onChange={() => {}} />
    <Input value="NPWP 01.234.567.8-901.000" onChange={() => {}} disabled />
  </div>
);
