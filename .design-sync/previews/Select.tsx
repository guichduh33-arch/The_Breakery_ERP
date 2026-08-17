import { Select } from '@breakery/ui';

// Le <select> natif stylé du kit — même surface et hauteur que Input.
export const States = () => (
  <div className="grid max-w-sm gap-4 bg-bg-base p-6">
    <Select value="dine_in" onChange={() => {}}>
      <option value="dine_in">Sur place</option>
      <option value="take_away">À emporter</option>
      <option value="delivery">Livraison</option>
    </Select>
    <Select value="qris" onChange={() => {}}>
      <option value="cash">Espèces</option>
      <option value="qris">QRIS</option>
      <option value="card">Carte bancaire</option>
      <option value="b2b">Compte B2B</option>
    </Select>
    <Select value="viennoiseries" onChange={() => {}} disabled>
      <option value="viennoiseries">Viennoiseries</option>
      <option value="pains">Pains</option>
    </Select>
  </div>
);

// Même famille sous le thème ivoire du back-office.
export const Backoffice = () => (
  <div className="theme-backoffice grid max-w-sm gap-4 bg-bg-base p-6">
    <Select value="all" onChange={() => {}}>
      <option value="all">Toutes les catégories</option>
      <option value="viennoiseries">Viennoiseries</option>
      <option value="pains">Pains</option>
      <option value="patisseries">Pâtisseries</option>
    </Select>
    <Select value="month" onChange={() => {}}>
      <option value="day">Aujourd'hui</option>
      <option value="week">Cette semaine</option>
      <option value="month">Ce mois-ci</option>
    </Select>
  </div>
);
