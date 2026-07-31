// Tailwind config for design-sync preview CSS only (not an app build).
// Compiles the utility classes used by packages/ui components + authored
// previews into packages/ui/dist/ds-preview.css (cfg.cssEntry).
//
// The safelist ships the DS's whole utility vocabulary (token-backed families
// + a curated layout core) so designs built by the claude.ai/design agent get
// working classes even for utilities no shipped component happens to use —
// the rendered designs consume this static CSS, there is no JIT at runtime.
import type { Config } from 'tailwindcss';
import preset from '../packages/ui/tailwind-preset';

const TOKEN_COLORS =
  '(bg-base|bg-elevated|bg-overlay|bg-input|surface-[0-4]|cream|backdrop|' +
  'border-subtle|border-strong|border-focus|border-muted|border-gold|' +
  'text-primary|text-secondary|text-muted|text-subtle|text-disabled|' +
  'gold|gold-hover|gold-pressed|gold-soft|gold-strong|gold-fg|' +
  'green|green-hover|green-pressed|green-fg|red|red-soft|red-fg|' +
  'blue-info|amber-warn|success|success-soft|warning|warning-soft|' +
  'danger|danger-soft|danger-fg|info|info-soft|' +
  'payment-cash|payment-card|payment-qris|payment-voucher|' +
  'cat-(amber|yellow|orange|lime|green|emerald|cyan|blue|indigo|violet|rose|red))';

const config: Config = {
  presets: [preset as Config],
  content: [
    'packages/ui/src/**/*.{ts,tsx}',
    '.design-sync/previews/**/*.tsx',
  ],
  safelist: [
    // token-backed color utilities — the DS's design language, exhaustively
    { pattern: new RegExp(`^(bg|text|border)-${TOKEN_COLORS}$`) },
    { pattern: new RegExp(`^(bg|border)-cat-(amber|yellow|orange|lime|green|emerald|cyan|blue|indigo|violet|rose|red)\\/(10|15|20|30)$`) },
    // typography / radius / elevation / motion token utilities
    { pattern: /^font-(body|serif|data|display|mono|sans|normal|medium|semibold|bold)$/ },
    { pattern: /^text-(xs|sm|base|lg|xl|2xl|3xl|display|left|center|right)$/ },
    { pattern: /^(uppercase|lowercase|capitalize|normal-case|italic|not-italic|truncate|underline|line-through|tabular-nums)$/ },
    { pattern: /^tracking-(tight|normal|wide|wider|widest|ultra)$/ },
    { pattern: /^leading-(tight|snug|base|loose|none)$/ },
    { pattern: /^rounded(-(sm|md|lg|xl|2xl|full|none))?$/ },
    { pattern: /^shadow(-(xs|sm|md|lg|xl|modal|inset-sm|inset-md|focus|none))?$/ },
    { pattern: /^duration-(fast|base|slow)$/ },
    { pattern: /^ease-motion-(out|in)$/ },
    { pattern: /^(transition|transition-colors|transition-shadow|transition-transform|animate-pulse|animate-spin)$/ },
    // curated layout core (rendered designs have no JIT — ship the basics)
    { pattern: /^(flex|inline-flex|grid|block|inline-block|hidden|relative|absolute|fixed|sticky|isolate)$/ },
    { pattern: /^(flex-(row|col|wrap|nowrap|1|auto|none)|grow|grow-0|shrink|shrink-0)$/ },
    { pattern: /^grid-cols-(1|2|3|4|5|6|12)$/ },
    { pattern: /^(items|justify|self)-(start|end|center|between|around|stretch|baseline)$/ },
    { pattern: /^(gap|gap-x|gap-y|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|space-x|space-y)-(0|0\.5|1|1\.5|2|2\.5|3|4|5|6|8|10|12|16)$/ },
    { pattern: /^(mx|ml|mr|mt|mb)-auto$/ },
    { pattern: /^(p|px|py|gap)-(gutter-card|gutter-page|gutter-section)$/ },
    { pattern: /^(w|h|min-w|min-h|max-w|max-h)-(full|fit|min|max|auto|screen|touch-min|touch-comfy|touch-large)$/ },
    { pattern: /^(w|h)-(1|2|3|4|5|6|8|10|12|16|20|24|32|40|48|56|64|72|80|96)$/ },
    { pattern: /^max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl)$/ },
    { pattern: /^(overflow|overflow-x|overflow-y)-(auto|hidden|scroll|visible)$/ },
    { pattern: /^(border|border-0|border-2|border-t|border-b|border-l|border-r|divide-y|divide-x)$/ },
    { pattern: /^(opacity-(0|25|50|75|100)|pointer-events-none|cursor-pointer|cursor-not-allowed|select-none)$/ },
    { pattern: /^(inset-0|top-0|bottom-0|left-0|right-0|z-(0|10|20|30|40|50))$/ },
  ],
};

export default config;
