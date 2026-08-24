import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const preset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'var(--bg-base)',
          elevated: 'var(--bg-elevated)',
          overlay: 'var(--bg-overlay)',
          input: 'var(--bg-input)',
        },
        // Session 14: numeric surface scale (parallel to bg-* aliases).
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          4: 'var(--surface-4)',
          // Refonte shell 2026-08-05 — remplissage inerte (en-tête et pied de
          // tableau, champ non éditable). Hors rampe : ce n'est pas un cran de
          // distance à l'œil, c'est un fond « ce bloc ne se lit pas ».
          inert: 'var(--surface-inert)',
        },
        cream: 'var(--cream)',
        border: {
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
          muted: 'var(--border-muted)',
          row: 'var(--border-row)',
          gold: 'var(--border-gold)',
        },
        // Refonte shell 2026-08-05 — famille encre : fonds sombres dans un thème
        // clair (top bar, bouton primaire). N'appartient à aucun cran de --surface-N.
        ink: {
          DEFAULT: 'var(--ink-base)',
          hover: 'var(--ink-hover)',
          raised: 'var(--ink-raised)',
          border: 'var(--ink-border)',
          fg: 'var(--ink-fg)',
          'fg-muted': 'var(--ink-fg-muted)',
          'fg-dim': 'var(--ink-fg-dim)',
          'fg-sub': 'var(--ink-fg-sub)',
          gold: 'var(--ink-gold)',
          // Sémantique éclaircie pour un fond encre — `text-ink-success`.
          success: 'var(--ink-success)',
          danger: 'var(--ink-danger)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          subtle: 'var(--text-subtle)',
          disabled: 'var(--text-disabled)',
          // Le cran sous le désactivé — ponctuation structurelle (séparateur de
          // fil d'Ariane, chevron éteint), jamais du texte à lire.
          inert: 'var(--text-inert)',
        },
        // Rampe de data-viz. Les séries de graphique la prennent ; les teintes
        // cat-* restent l'identité d'une catégorie de produit.
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
        },
        gold: {
          DEFAULT: 'var(--gold-base)',
          hover: 'var(--gold-hover)',
          pressed: 'var(--gold-pressed)',
          soft: 'var(--gold-soft)',
          strong: 'var(--gold-strong)',
          fg: 'var(--gold-fg)',
        },
        green: {
          DEFAULT: 'var(--green-base)',
          hover: 'var(--green-hover)',
          pressed: 'var(--green-pressed)',
          fg: 'var(--green-fg)',
        },
        red: {
          DEFAULT: 'var(--red-base)',
          soft: 'var(--red-soft)',
          // `-fg` signifie « premier plan SUR un aplat » partout ailleurs
          // (--gold-fg, --green-fg). --red-fg était le seul à signifier
          // l'inverse ; les deux rôles portent désormais leur nom.
          'as-text': 'var(--red-as-text)',
          'on-fill': 'var(--red-on-fill)',
        },
        blue: { info: 'var(--blue-info)' },
        // `fg` = premier plan SUR l'aplat ambre, comme gold.fg / green.fg.
        amber: { warn: 'var(--amber-warn)', fg: 'var(--amber-fg)' },
        backdrop: 'var(--backdrop)',
        // Semantic aliases (Session 13 / ui-steward batch 1) — components
        // express intent via these utilities, not raw palette names.
        success: {
          DEFAULT: 'var(--success)',
          soft: 'var(--success-soft)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          soft: 'var(--warning-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
          // `text-danger-fg` se pose sur `bg-danger` : c'est un on-fill.
          // Il pointait vers l'ancien --red-fg, c'est-à-dire vers la même
          // couleur que le remplissage.
          fg: 'var(--red-on-fill)',
        },
        info: {
          DEFAULT: 'var(--info)',
          soft: 'var(--info-soft)',
        },
        // Payment-method tokens (Session 13 / ui-steward batch 1).
        payment: {
          cash:    'var(--payment-cash)',
          card:    'var(--payment-card)',
          qris:    'var(--payment-qris)',
          voucher: 'var(--payment-voucher)',
        },
        // Categorical identity hues (design audit 2026-07-07) — RGB-triplet
        // tokens so alpha modifiers work: bg-cat-amber/15, border-cat-blue/30.
        cat: {
          amber:   'rgb(var(--cat-amber) / <alpha-value>)',
          yellow:  'rgb(var(--cat-yellow) / <alpha-value>)',
          orange:  'rgb(var(--cat-orange) / <alpha-value>)',
          lime:    'rgb(var(--cat-lime) / <alpha-value>)',
          green:   'rgb(var(--cat-green) / <alpha-value>)',
          emerald: 'rgb(var(--cat-emerald) / <alpha-value>)',
          cyan:    'rgb(var(--cat-cyan) / <alpha-value>)',
          blue:    'rgb(var(--cat-blue) / <alpha-value>)',
          indigo:  'rgb(var(--cat-indigo) / <alpha-value>)',
          violet:  'rgb(var(--cat-violet) / <alpha-value>)',
          rose:    'rgb(var(--cat-rose) / <alpha-value>)',
          red:     'rgb(var(--cat-red) / <alpha-value>)',
        },
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
      },
      transitionTimingFunction: {
        'motion-out': 'var(--motion-ease-out)',
        'motion-in':  'var(--motion-ease-in)',
      },
      fontFamily: {
        // Session 14 D3 — 4 canonical fonts via tokens.
        sans:    ['var(--font-body)'],
        body:    ['var(--font-body)'],
        serif:   ['var(--font-serif)'],
        data:    ['var(--font-data)'],
        display: ['var(--font-display)'],
        mono:    ['var(--font-mono)'],
        // --font-brand existait depuis typography.css mais AUCUN utilitaire ne
        // l'exposait : le monogramme du back-office portait `font-display`, que
        // `.theme-backoffice` remappe sur la pile du corps — il rendait donc en
        // Instrument Sans, quand trois énoncés du dépôt affirmaient Playfair
        // (relevé du 2026-08-18). `font-brand` est le SEUL utilitaire qui sorte
        // Playfair sous ce thème ; il est réservé aux surfaces de MARQUE — le
        // monogramme de la barre de navigation, et rien d'autre (DESIGN.md,
        // The Playfair-Is-Brand-Only Rule). `BrandMark` lit --font-brand
        // directement, en attribut SVG, sans passer par cet utilitaire.
        brand:   ['var(--font-brand)'],
      },
      fontSize: {
        // Session 14 — explicit type scale so callers stop using ad-hoc Tailwind defaults.
        xs:      ['var(--type-xs)',      { lineHeight: 'var(--leading-snug)' }],
        sm:      ['var(--type-sm)',      { lineHeight: 'var(--leading-snug)' }],
        base:    ['var(--type-base)',    { lineHeight: 'var(--leading-base)' }],
        lg:      ['var(--type-lg)',      { lineHeight: 'var(--leading-base)' }],
        xl:      ['var(--type-xl)',      { lineHeight: 'var(--leading-snug)' }],
        '2xl':   ['var(--type-2xl)',     { lineHeight: 'var(--leading-tight)' }],
        '3xl':   ['var(--type-3xl)',     { lineHeight: 'var(--leading-tight)' }],
        display: ['var(--type-display)', { lineHeight: 'var(--leading-tight)' }],
      },
      letterSpacing: {
        tight:   'var(--tracking-tight)',
        normal:  'var(--tracking-normal)',
        wide:    'var(--tracking-wide)',
        wider:   'var(--tracking-wider)',
        widest:  'var(--tracking-widest)',
        ultra:   'var(--tracking-ultra)',
      },
      lineHeight: {
        tight: 'var(--leading-tight)',
        snug:  'var(--leading-snug)',
        base:  'var(--leading-base)',
        loose: 'var(--leading-loose)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        // `shadow-float` — panneau déroulant, menu. Le cran entre `lg` et
        // `modal`. Il rend enfin `shadow-[0_18px_40px_rgba(28,23,18,0.20)]`
        // inutile : cette valeur était recopiée dans trois fichiers du BO,
        // sur une base de teinte que le thème n'utilisait nulle part ailleurs.
        float: 'var(--shadow-float)',
        modal: 'var(--shadow-modal)',
        'inset-sm': 'var(--shadow-inset-sm)',
        'inset-md': 'var(--shadow-inset-md)',
        focus: 'var(--shadow-focus)',
        // Audit cohérence 2026-08-01 — filet d'élévation du thème sombre.
        // En clair le token vaut `none`, l'utilitaire est donc sans effet.
        hairline: 'var(--elev-hairline)',
      },
      backdropBlur: { md: 'var(--backdrop-blur)' },
      spacing: {
        // Session 14 — semantic spacing tokens alongside Tailwind defaults.
        'touch-min': 'var(--touch-min)',
        'touch-comfy': 'var(--touch-comfy)',
        'touch-large': 'var(--touch-large)',
        // Audit cohérence 2026-08-01 — palier dense pour le rush caisse.
        'gutter-compact': 'var(--gutter-compact)',
        'gutter-card':    'var(--gutter-card)',
        'gutter-page':    'var(--gutter-page)',
        'gutter-section': 'var(--gutter-section)',
        // Re-audit 2026-08-24 — safe-area Capacitor. `safe-bottom` colle à la
        // barre gestuelle ; `safe-bottom-gutter` garantit EN PLUS la gouttière
        // minimale d'une barre d'actions (max avec 0.625rem). Remplacent les
        // inline styles env() qui étaient les seules occurrences du repo.
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-bottom-gutter': 'max(0.625rem, env(safe-area-inset-bottom, 0px))',
      },
    },
  },
  plugins: [animate],
};

export default preset;
