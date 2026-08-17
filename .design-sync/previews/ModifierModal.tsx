import { ModifierModal } from '@breakery/ui';

// Personnalisation d'un Latte avant ajout au panier — un groupe single_select
// requis (Temperature), un groupe Size requis, un groupe multi_select Extras.
// Les défauts (is_default) pré-sélectionnent Hot + Regular ; le total suit.
const product = {
  id: 'prod-latte',
  name: 'Latte',
  retail_price: 32000,
  image_url: null,
};

const groups = [
  {
    group_name: 'Temperature',
    group_sort_order: 1,
    group_required: true,
    group_type: 'single_select' as const,
    options: [
      { option_label: 'Hot', option_sort_order: 1, price_adjustment: 0, is_default: true },
      { option_label: 'Iced', option_sort_order: 2, price_adjustment: 3000, is_default: false },
    ],
  },
  {
    group_name: 'Size',
    group_sort_order: 2,
    group_required: true,
    group_type: 'single_select' as const,
    options: [
      { option_label: 'Regular', option_sort_order: 1, price_adjustment: 0, is_default: true },
      { option_label: 'Large', option_sort_order: 2, price_adjustment: 5000, is_default: false },
    ],
  },
  {
    group_name: 'Extras',
    group_sort_order: 3,
    group_required: false,
    group_type: 'multi_select' as const,
    options: [
      { option_label: 'Extra shot', option_sort_order: 1, price_adjustment: 8000, is_default: false },
      { option_label: 'Oat milk', option_sort_order: 2, price_adjustment: 10000, is_default: true },
      { option_label: 'Vanilla syrup', option_sort_order: 3, price_adjustment: 6000, is_default: false },
    ],
  },
];

export const Open = () => (
  <div className="fixed inset-0 bg-bg-base">
    <ModifierModal
      open
      product={product}
      groups={groups}
      onClose={() => {}}
      onConfirm={() => {}}
    />
  </div>
);
