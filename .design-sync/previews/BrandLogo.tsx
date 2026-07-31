import { BrandLogo } from '@breakery/ui';

// POS dark-surface artwork, lg (POS Login centered, default) — tagline shown
// by default at this size.
export const PosWithTagline = () => (
  <div className="bg-bg-base p-6 rounded-lg w-96 flex items-center justify-center">
    <BrandLogo size="lg" />
  </div>
);

// Tagline-less crop, md — compact placement (modal headers).
export const PosPlainCompact = () => (
  <div className="bg-bg-base p-6 rounded-lg w-96 flex items-center justify-center">
    <BrandLogo size="md" showTagline={false} />
  </div>
);

// Light-surface variant on the BackOffice ivory theme — always tagline-less.
export const BackofficeLight = () => (
  <div className="theme-backoffice bg-bg-base p-6 rounded-lg w-96 flex items-center justify-center">
    <BrandLogo size="md" theme="backoffice" />
  </div>
);
