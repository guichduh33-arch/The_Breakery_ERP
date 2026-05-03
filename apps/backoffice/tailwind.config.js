import preset from '@breakery/ui/tailwind-preset';
export default {
    presets: [preset],
    content: [
        './index.html',
        './src/**/*.{ts,tsx}',
        '../../packages/ui/src/**/*.{ts,tsx}'
    ]
};
