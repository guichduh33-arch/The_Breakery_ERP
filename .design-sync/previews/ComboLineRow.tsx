import { ComboLineRow } from '@breakery/ui';

// Lignes combo du panier POS — composants indentés, stepper, prix serveur.
const petitDej = {
  id: 'line-1',
  product_id: 'combo-pdj',
  name: 'Combo Petit Déjeuner',
  sku: 'CMB-001',
  quantity: 1,
  unit_price: 65_000,
  line_total: 65_000,
};

const gouter = {
  id: 'line-2',
  product_id: 'combo-gouter',
  name: 'Combo Goûter',
  sku: 'CMB-004',
  quantity: 2,
  unit_price: 48_000,
  line_total: 96_000,
};

export const Panier = () => (
  <div className="bg-bg-base p-6">
    <div className="w-[640px] rounded-xl border border-border-subtle bg-bg-elevated text-text-primary">
      <ComboLineRow
        comboItem={petitDej}
        components={[
          { name: 'Croissant beurre', quantity: 1 },
          { name: "Jus d'orange pressé", quantity: 1 },
          { name: 'Café allongé', quantity: 1 },
        ]}
        onRemove={() => {}}
        onQuantityChange={() => {}}
      />
      <ComboLineRow
        comboItem={gouter}
        components={[
          { name: 'Pain au chocolat', quantity: 2 },
          { name: 'Thé glacé maison', quantity: 1 },
        ]}
        onRemove={() => {}}
        onQuantityChange={() => {}}
        className="border-b-0"
      />
    </div>
  </div>
);

// Combo verrouillé (envoyé en cuisine) — stepper inerte, pas de suppression.
export const Verrouille = () => (
  <div className="bg-bg-base p-6">
    <div className="w-[640px] rounded-xl border border-border-subtle bg-bg-elevated text-text-primary">
      <ComboLineRow
        comboItem={petitDej}
        components={[
          { name: 'Croissant beurre', quantity: 1 },
          { name: "Jus d'orange pressé", quantity: 1 },
        ]}
        onQuantityChange={() => {}}
        isLocked
        className="border-b-0"
      />
    </div>
  </div>
);
