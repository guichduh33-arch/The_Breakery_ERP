import { CustomerCategoryBadge, type CustomerCategory } from '@breakery/ui';

const cat = (
  name: string,
  slug: string,
  color: string | null,
  icon: string | null,
  extra: Partial<CustomerCategory> = {},
): CustomerCategory => ({
  id: slug,
  name,
  slug,
  color,
  icon,
  price_modifier_type: 'retail',
  discount_percentage: 0,
  loyalty_enabled: true,
  points_multiplier: 1,
  is_default: false,
  ...extra,
});

const B2B = cat('B2B Café', 'b2b-cafe', '#6366F1', '🏢', { price_modifier_type: 'wholesale' });
const STAFF = cat('Staff', 'staff', '#10B981', '👩‍🍳', { price_modifier_type: 'discount_percentage', discount_percentage: 30 });
const VIP = cat('VIP', 'vip', '#D4AF37', '⭐', { points_multiplier: 2 });
const RESELLER = cat('Revendeur', 'revendeur', null, null); // couleur null → gris fallback

// Pilule teintée par la couleur de la catégorie (alpha 20 %) + icône ; la
// catégorie null rend la pilule neutre « Retail » ; couleur null → fallback gris.
export const Categories = () => (
  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-bg-base p-6">
    <CustomerCategoryBadge category={null} />
    <CustomerCategoryBadge category={B2B} />
    <CustomerCategoryBadge category={STAFF} />
    <CustomerCategoryBadge category={VIP} />
    <CustomerCategoryBadge category={RESELLER} />
  </div>
);

// Mêmes catégories sous le thème ivoire du back-office (liste clients).
export const Backoffice = () => (
  <div className="theme-backoffice flex flex-wrap items-center gap-3 rounded-lg bg-bg-base p-6">
    <CustomerCategoryBadge category={null} />
    <CustomerCategoryBadge category={B2B} />
    <CustomerCategoryBadge category={STAFF} />
    <CustomerCategoryBadge category={VIP} />
    <CustomerCategoryBadge category={RESELLER} />
  </div>
);
