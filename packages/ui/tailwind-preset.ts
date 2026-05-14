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
        border: {
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
        },
        gold: {
          DEFAULT: 'var(--gold-base)',
          hover: 'var(--gold-hover)',
          pressed: 'var(--gold-pressed)',
          soft: 'var(--gold-soft)',
        },
        green: {
          DEFAULT: 'var(--green-base)',
          hover: 'var(--green-hover)',
          pressed: 'var(--green-pressed)',
        },
        red: {
          DEFAULT: 'var(--red-base)',
          soft: 'var(--red-soft)',
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
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        modal: 'var(--shadow-modal)',
      },
      backdropBlur: { md: 'var(--backdrop-blur)' },
      spacing: {
        'touch-min': 'var(--touch-min)',
        'touch-comfy': 'var(--touch-comfy)',
        'touch-large': 'var(--touch-large)',
      },
    },
  },
  plugins: [animate],
};

export default preset;
