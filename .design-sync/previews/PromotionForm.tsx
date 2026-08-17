import { PromotionForm, emptyPromotionValues, type PromotionFormOption } from '@breakery/ui';

// Formulaire de promotion du back-office (thème ivoire) — onglet General par défaut.
const productOptions: PromotionFormOption[] = [
  { id: 'p1', label: 'Croissant beurre' },
  { id: 'p2', label: 'Pain au chocolat' },
  { id: 'p3', label: 'Latte' },
  { id: 'p4', label: 'Baguette tradition' },
];

const categoryOptions: PromotionFormOption[] = [
  { id: 'c1', label: 'Viennoiseries' },
  { id: 'c2', label: 'Boissons' },
  { id: 'c3', label: 'Pains' },
];

const customerCategoryOptions: PromotionFormOption[] = [
  { id: 'cc1', label: 'B2B' },
  { id: 'cc2', label: 'Staff' },
];

const customerTierOptions: PromotionFormOption[] = [
  { id: 't1', label: 'Gold' },
  { id: 't2', label: 'Silver' },
];

// Édition d'une promotion percentage remplie — Happy Hour −15 % sur tout le panier
// (scope cart : le formulaire tient entier dans la cellule, footer inclus).
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <div className="mx-auto max-w-2xl rounded-xl border border-border-subtle bg-bg-elevated p-6">
      <PromotionForm
        mode="edit"
        initialValues={{
          ...emptyPromotionValues(),
          id: 'promo-happy-hour',
          name: 'Happy Hour Beverage',
          slug: 'happy-hour-beverage',
          description: '−15 % sur tout le panier entre 15h et 17h',
          type: 'percentage',
          scope: 'cart',
          discount_value: 15,
          max_discount_amount: 20_000,
          start_hour: 15,
          end_hour: 17,
        }}
        productOptions={productOptions}
        categoryOptions={categoryOptions}
        customerCategoryOptions={customerCategoryOptions}
        customerTierOptions={customerTierOptions}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </div>
  </div>
);

// Création vierge — valeurs par défaut (percentage / scope cart, badge assorti).
export const Creation = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <div className="mx-auto max-w-2xl rounded-xl border border-border-subtle bg-bg-elevated p-6">
      <PromotionForm
        mode="create"
        productOptions={productOptions}
        categoryOptions={categoryOptions}
        customerCategoryOptions={customerCategoryOptions}
        customerTierOptions={customerTierOptions}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </div>
  </div>
);
