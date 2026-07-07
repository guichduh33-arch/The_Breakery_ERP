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
        },
        cream: 'var(--cream)',
        border: {
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
          muted: 'var(--border-muted)',
          gold: 'var(--border-gold)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          subtle: 'var(--text-subtle)',
          disabled: 'var(--text-disabled)',
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
          fg: 'var(--red-fg)',
        },
        blue: { info: 'var(--blue-info)' },
        amber: { warn: 'var(--amber-warn)' },
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
          fg: 'var(--red-fg)',
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
        modal: 'var(--shadow-modal)',
        'inset-sm': 'var(--shadow-inset-sm)',
        'inset-md': 'var(--shadow-inset-md)',
        focus: 'var(--shadow-focus)',
      },
      backdropBlur: { md: 'var(--backdrop-blur)' },
      spacing: {
        // Session 14 — semantic spacing tokens alongside Tailwind defaults.
        'touch-min': 'var(--touch-min)',
        'touch-comfy': 'var(--touch-comfy)',
        'touch-large': 'var(--touch-large)',
        'gutter-card':    'var(--gutter-card)',
        'gutter-page':    'var(--gutter-page)',
        'gutter-section': 'var(--gutter-section)',
      },
    },
  },
  plugins: [animate],
};

export default preset;
