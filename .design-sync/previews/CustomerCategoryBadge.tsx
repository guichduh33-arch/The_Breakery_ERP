import { CustomerCategoryBadge, type CustomerCategory } from '@breakery/ui';

const category = (over: Partial<CustomerCategory> & Pick<CustomerCategory, 'id' | 'name' | 'slug'>): CustomerCategory => ({
  color: null,
  icon: null,
  price_modifier_type: 'retail',
  discount_percentage: 0,
  loyalty_enabled: true,
  points_multiplier: 1,
  is_default: false,
  ...over,
});

const wholesale = category({
  id: 'cc-1',
  name: 'Wholesale',
  slug: 'wholesale',
  color: '#8B5CF6',
  icon: '🏬',
  price_modifier_type: 'wholesale',
});

const staff = category({
  id: 'cc-2',
  name: 'Staff',
  slug: 'staff',
  color: '#10B981',
  icon: '👩‍🍳',
  price_modifier_type: 'discount_percentage',
  discount_percentage: 30,
});

const hotel = category({
  id: 'cc-3',
  name: 'Hotel Partner',
  slug: 'hotel-partner',
  color: '#F59E0B',
  icon: '🏨',
  price_modifier_type: 'custom',
});

const uncolored = category({ id: 'cc-4', name: 'Community', slug: 'community' });

// Category sweep — null renders the built-in Retail fallback; a category with
// no color/icon falls back to the slate dot (#64748B at 20 % alpha).
export const CategorySweep = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-wrap items-center gap-2 w-96">
    <CustomerCategoryBadge category={null} />
    <CustomerCategoryBadge category={wholesale} />
    <CustomerCategoryBadge category={staff} />
    <CustomerCategoryBadge category={hotel} />
    <CustomerCategoryBadge category={uncolored} />
  </div>
);

// In context — attached-customer chip on the cart panel.
export const OnCartCustomer = () => (
  <div className="bg-bg-base p-6 rounded-lg flex items-center justify-between gap-4 w-96">
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text-primary">Grand Sumatra Hotel</span>
      <span className="text-xs text-text-muted">Daily pastry standing order</span>
    </div>
    <CustomerCategoryBadge category={hotel} />
  </div>
);
