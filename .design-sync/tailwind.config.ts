// design-sync — compile la feuille Tailwind du design system pour les aperçus
// Claude Design. Même preset que les apps (packages/ui/tailwind-preset.ts) ;
// content = sources du package UI + aperçus rédigés pour le sync.
// Exécuté depuis la racine du repo (voir buildCmd dans config.json).
import type { Config } from 'tailwindcss';
import preset from '../packages/ui/tailwind-preset';

const config: Config = {
  presets: [preset as Config],
  content: [
    './packages/ui/src/**/*.{ts,tsx}',
    './.design-sync/previews/**/*.tsx',
  ],
  // La feuille expédiée à Claude Design est statique : une classe absente n'y
  // sera jamais générée à la volée. On garantit donc tout le vocabulaire du
  // PRESET (l'identité de la marque) ; les utilitaires layout standards
  // viennent de l'usage réel (sources ui + aperçus).
  safelist: [
    { pattern: /^(bg|text|border)-(bg|surface|ink|gold|green|red|amber|success|warning|danger|info|payment|chart|cream|backdrop)(-[a-z0-9-]+)?$/ },
    { pattern: /^text-text-(primary|secondary|muted|subtle|disabled|inert)$/ },
    { pattern: /^border-border-(subtle|strong|focus|muted|row|gold)$/ },
    { pattern: /^(bg|text|border)-(blue-info|amber-warn|amber-fg)$/ },
    { pattern: /^(bg|text|border)-cat-(amber|yellow|orange|lime|green|emerald|cyan|blue|indigo|violet|rose|red)$/ },
    { pattern: /^font-(body|serif|data|display|mono|sans)$/ },
    { pattern: /^text-(xs|sm|base|lg|xl|2xl|3xl|display)$/ },
    { pattern: /^tracking-(tight|wide|wider|widest|ultra)$/ },
    { pattern: /^leading-(tight|snug|base|loose)$/ },
    { pattern: /^rounded-(sm|md|lg|xl|2xl)$/ },
    { pattern: /^shadow-(xs|sm|md|lg|xl|modal|inset-sm|inset-md|focus|hairline)$/ },
    { pattern: /^(p|px|py|pt|pb|gap|h|w|min-h|min-w)-(touch-min|touch-comfy|touch-large)$/ },
    { pattern: /^(p|px|py|gap)-(gutter-compact|gutter-card|gutter-page|gutter-section)$/ },
    { pattern: /^duration-(fast|base|slow)$/ },
    { pattern: /^ease-motion-(out|in)$/ },
  ],
};

export default config;
