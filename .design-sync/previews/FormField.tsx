import { FormField, Input, Select } from '@breakery/ui';

// Label + contrôle + indice : le câblage a11y (htmlFor, aria-describedby) est porté par le champ.
export const WithHint = () => (
  <div className="grid max-w-sm gap-6 bg-bg-base p-6">
    <FormField
      id="ff-product-name"
      label="Nom du produit"
      hint="Tel qu'affiché sur la grille POS."
    >
      <Input value="Pain au chocolat" onChange={() => {}} />
    </FormField>
    <FormField id="ff-sku" label="SKU">
      <Input placeholder="VIEN-012" onChange={() => {}} />
    </FormField>
  </div>
);

// Requis + erreur : astérisque hors flux vocal, message rattaché via aria-describedby.
export const RequiredError = () => (
  <div className="grid max-w-sm gap-6 bg-bg-base p-6">
    <FormField
      id="ff-price"
      label="Prix de vente (Rp)"
      required
      error="Le prix doit être supérieur à 0."
    >
      <Input
        type="number"
        value="0"
        onChange={() => {}}
        className="font-mono tabular-nums"
      />
    </FormField>
    <FormField id="ff-cost" label="Coût matière (Rp)" required>
      <Input
        type="number"
        value="12500"
        onChange={() => {}}
        className="font-mono tabular-nums"
      />
    </FormField>
  </div>
);

// Le champ enveloppe aussi le Select natif du kit.
export const WithSelect = () => (
  <div className="grid max-w-sm gap-6 bg-bg-base p-6">
    <FormField
      id="ff-category"
      label="Catégorie"
      required
      hint="Détermine la grille et la couleur POS."
    >
      <Select value="viennoiseries" onChange={() => {}}>
        <option value="viennoiseries">Viennoiseries</option>
        <option value="pains">Pains</option>
        <option value="patisseries">Pâtisseries</option>
        <option value="boissons">Boissons</option>
      </Select>
    </FormField>
  </div>
);

// Formulaire back-office ivoire.
export const Backoffice = () => (
  <div className="theme-backoffice grid max-w-sm gap-6 bg-bg-base p-6">
    <FormField id="ff-bo-client" label="Client B2B" required>
      <Input value="Warung Kopi Senggigi" onChange={() => {}} />
    </FormField>
    <FormField
      id="ff-bo-limit"
      label="Plafond de crédit (Rp)"
      hint="Encours maximum autorisé avant blocage des commandes."
      error="Le plafond ne peut pas être inférieur à l'encours actuel (Rp 2,450,000)."
    >
      <Input
        type="number"
        value="2000000"
        onChange={() => {}}
        className="font-mono tabular-nums"
      />
    </FormField>
  </div>
);
