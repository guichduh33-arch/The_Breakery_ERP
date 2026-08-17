import { BrandMark } from '@breakery/ui';

// L'axe size — sm 32 (sidebar BO), md 40 (POS top-left), lg 64 (Customer
// Display), xl 96 (hero de login). Badge rond or, glyphe serif italique.
export const Sizes = () => (
  <div className="flex items-end gap-10 bg-bg-base p-6">
    {(['sm', 'md', 'lg', 'xl'] as const).map((s) => (
      <div key={s} className="flex flex-col items-center gap-2">
        <BrandMark size={s} />
        <span className="text-xs text-text-muted">{s}</span>
      </div>
    ))}
  </div>
);

// Les mêmes tailles sous le thème ivoire du back-office (sidebar, login BO).
export const Backoffice = () => (
  <div className="theme-backoffice flex items-end gap-10 bg-bg-base p-6">
    {(['sm', 'md', 'lg', 'xl'] as const).map((s) => (
      <div key={s} className="flex flex-col items-center gap-2">
        <BrandMark size={s} />
        <span className="text-xs text-text-muted">{s}</span>
      </div>
    ))}
  </div>
);
