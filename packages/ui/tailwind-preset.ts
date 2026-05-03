import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const preset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {}
  },
  plugins: [animate]
};

export default preset;
