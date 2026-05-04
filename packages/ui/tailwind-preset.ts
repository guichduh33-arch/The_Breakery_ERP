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
