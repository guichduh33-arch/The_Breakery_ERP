import { BrandLogo } from '@breakery/ui';

// L'axe size sur surface sombre POS — sm 52 / md 84 (sans tagline par défaut),
// lg 128 / xl 190 (tagline « FAIT MAISON / FRENCH BAKERY » par défaut).
export const Sizes = () => (
  <div className="flex flex-wrap items-end gap-10 bg-bg-base p-6">
    {(['sm', 'md', 'lg', 'xl'] as const).map((s) => (
      <div key={s} className="flex flex-col items-center gap-2">
        <BrandLogo size={s} />
        <span className="text-xs text-text-muted">{s}</span>
      </div>
    ))}
  </div>
);

// Contrôle du tagline en lg : crop avec slogan vs crop nu (héros compact).
export const Tagline = () => (
  <div className="flex items-end gap-12 bg-bg-base p-6">
    <div className="flex flex-col items-center gap-2">
      <BrandLogo size="lg" showTagline />
      <span className="text-xs text-text-muted">showTagline</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <BrandLogo size="lg" showTagline={false} />
      <span className="text-xs text-text-muted">showTagline=false</span>
    </div>
  </div>
);

// Variante claire pour surfaces ivoire BO — lettres noires, toujours sans tagline.
export const Backoffice = () => (
  <div className="theme-backoffice flex items-end gap-10 bg-bg-base p-6">
    <div className="flex flex-col items-center gap-2">
      <BrandLogo theme="backoffice" size="md" />
      <span className="text-xs text-text-muted">md</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <BrandLogo theme="backoffice" size="lg" />
      <span className="text-xs text-text-muted">lg</span>
    </div>
  </div>
);
