import { LoyaltyBadge } from '@breakery/ui';

// Les 4 paliers fidélité avec soldes réalistes (format id-ID interne au
// composant), sur surface sombre POS.
export const Tiers = () => (
  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-bg-base p-6">
    <LoyaltyBadge tier="bronze" points={320} />
    <LoyaltyBadge tier="silver" points={1250} />
    <LoyaltyBadge tier="gold" points={5480} />
    <LoyaltyBadge tier="platinum" points={12760} />
  </div>
);

// Mêmes paliers sous le thème ivoire du back-office (module Loyalty).
export const Backoffice = () => (
  <div className="theme-backoffice flex flex-wrap items-center gap-3 rounded-lg bg-bg-base p-6">
    <LoyaltyBadge tier="bronze" points={320} />
    <LoyaltyBadge tier="silver" points={1250} />
    <LoyaltyBadge tier="gold" points={5480} />
    <LoyaltyBadge tier="platinum" points={12760} />
  </div>
);
