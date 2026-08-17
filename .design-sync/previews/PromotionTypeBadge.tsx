import { PromotionTypeBadge } from '@breakery/ui';

// Les 6 types de promotion — rampe catégorielle theme-aware (cat-*).
export const Types = () => (
  <div className="flex flex-wrap items-center gap-3 bg-bg-base p-6">
    <PromotionTypeBadge type="percentage" />
    <PromotionTypeBadge type="fixed_amount" />
    <PromotionTypeBadge type="bogo" />
    <PromotionTypeBadge type="free_product" />
    <PromotionTypeBadge type="threshold" />
    <PromotionTypeBadge type="bundle" />
  </div>
);

// Mêmes types sous le thème ivoire du back-office (liste des promotions).
export const Backoffice = () => (
  <div className="theme-backoffice flex flex-wrap items-center gap-3 bg-bg-base p-6">
    <PromotionTypeBadge type="percentage" />
    <PromotionTypeBadge type="fixed_amount" />
    <PromotionTypeBadge type="bogo" />
    <PromotionTypeBadge type="free_product" />
    <PromotionTypeBadge type="threshold" />
    <PromotionTypeBadge type="bundle" />
  </div>
);
