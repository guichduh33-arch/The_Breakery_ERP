# 06 — Iconography & Illustrations

> **Last verified**: 2026-05-03
> **Sources**: [`package.json`](../../../package.json) (`lucide-react ^0.303.0`), [`public/`](../../../public/), [`src/components/ui/BreakeryLogo.tsx`](../../../src/components/ui/BreakeryLogo.tsx), [`vite.config.ts`](../../../vite.config.ts) (PWA manifest)

AppGrav V2 ships **zero custom icon system**. Every icon comes from Lucide React. The only proprietary visuals are the Breakery logos in `/public` and the PWA icons used by the web app.

---

## 1. Lucide React (icon library)

| Field | Value |
|---|---|
| Package | `lucide-react` |
| Version | `^0.303.0` (locked in `package.json:57`) |
| Style | Outline (single-stroke), 24×24 default viewBox |
| License | ISC (free for commercial use) |

### Import convention

```tsx
import { ShoppingCart, Plus, Coffee, Boxes } from 'lucide-react';

<ShoppingCart size={48} strokeWidth={1} />
```

- **Tree-shakable** — only the icons you import are bundled.
- **Always import named, never default** — `import * as Icons from 'lucide-react'` defeats tree-shaking.
- **Prefer Lucide over emoji or text** for any actionable affordance.

### Sizing convention

| Size (px) | Tailwind / prop | Usage |
|---|---|---|
| **16** | `size={16}` | Inline within a label (e.g., loyalty tier dot, badge prefix). |
| **18** | `size={18}` | Compact list rows, mobile bottom nav inactive icons. |
| **20** | `size={20}` | Sidebar nav (BackOffice + POS), button leading icons (`[&_svg]:size-4` in `Button` is 16; sidebar uses 20 explicitly). |
| **24** | `size={24}` | Page-header icons, tablet bottom nav icons. |
| **32–48** | `size={48}` | Empty-state hero icons (e.g., `<ShoppingCart size={48} strokeWidth={1} />` in the empty Cart). |

### Stroke convention

- **`strokeWidth={1.8}`** (sidebar nav, BackOfficeLayout) — slightly thinner than Lucide's default of 2, matches the whisper-thin border aesthetic.
- **`strokeWidth={1}` to `1.5`** for hero / empty-state icons — gives them the delicate outlined look of menu illustrations.
- **`strokeWidth={2}`** (default) for action buttons, badges, and any high-contrast affordance.

### Conventional icon mappings (excerpt)

| Domain | Lucide icon |
|---|---|
| Dashboard | `LayoutDashboard` |
| POS | `Store` |
| KDS / Kitchen | `Utensils`, `ChefHat`, `UtensilsCrossed` |
| Products | `Coffee` |
| Stock / Inventory | `Boxes`, `Package` |
| Orders | `FileText`, `ShoppingCart` |
| B2B | `Building2` |
| Purchasing | `ShoppingCart` (same as orders, by intent) |
| Suppliers | `Truck` |
| Expenses | `Receipt` |
| Customers | `UserCircle`, `User`, `Users` |
| Reports | `BarChart3` |
| Accounting | `Calculator` |
| Settings | `Settings` |
| Notifications | `Bell` |
| Auth | `LogOut`, `Lock` |
| Mobile/Phone | `Smartphone` |
| LAN/Wifi | `Wifi` |
| Order types | `MapPin` (dine-in), `Bike` (delivery), `Package` (takeaway), `Building2` (B2B) — see [`OrderTypeIcon.tsx`](../../../src/components/ui/OrderTypeIcon.tsx) |
| Status | `CheckCircle`, `CheckCheck`, `AlertTriangle`, `Clock`, `Pause`, `Play` |
| Navigation chevrons | `ChevronLeft`, `ChevronRight`, `ChevronDown`, `ChevronUp` |
| Modals | `X` (close — every Radix-based primitive uses Lucide `X` in its close button) |

When introducing a new domain, **search the [Lucide library](https://lucide.dev) for an existing icon before considering anything custom**. Custom SVGs are reserved for branding moments only.

---

## 2. Brand Assets (`public/`)

| File | Size | Use |
|---|---|---|
| [`croissant.svg`](../../../public/croissant.svg) | Vector | Brand mark accent — currently unused in production but reserved for future loading screens or hero illustrations. |
| [`logo-breakery.png`](../../../public/logo-breakery.png) | Optimized PNG | Standard brand logo (light/dark agnostic). |
| [`logo-breakery-original.png`](../../../public/logo-breakery-original.png) | Original PNG | Higher-resolution master; **excluded from PWA pre-cache** via `globIgnores: ['**/logo-breakery-original*']` in `vite.config.ts:82`. |

### `BreakeryLogo` component

[`src/components/ui/BreakeryLogo.tsx`](../../../src/components/ui/BreakeryLogo.tsx) is the canonical way to render the brand:

```tsx
import { BreakeryLogo } from '@/components/ui/BreakeryLogo';

<BreakeryLogo size="md" variant="full" />     // standard (sidebar header)
<BreakeryLogo size="sm" variant="full" />     // collapsed sidebar
<BreakeryLogo size="lg" variant="mark" />     // big "B" (login, customer display)
```

| Prop | Values |
|---|---|
| `size` | `sm` / `md` / `lg` |
| `variant` | `mark` (just the italic Playfair "B") / `full` (lockup with wordmark) |

The "B" mark is rendered as live HTML/SVG (Playfair Display italic at multiple sizes) — not a raster image. This guarantees crisp rendering at any density.

---

## 3. PWA Icons

Configured in [`vite.config.ts:30-77`](../../../vite.config.ts#L30) via `vite-plugin-pwa`.

| Asset | Size | Purpose |
|---|---|---|
| [`pwa-192x192.png`](../../../public/pwa-192x192.png) | 192×192 | Android home-screen icon (mdpi/hdpi), Apple touch icon, PWA shortcut icons. |
| [`pwa-512x512.png`](../../../public/pwa-512x512.png) | 512×512 | Android home-screen icon (xxhdpi), splash screen source. |
| [`pwa-512x512.png`](../../../public/pwa-512x512.png) (with `purpose: "maskable"`) | 512×512 | Android adaptive icon — must include 20% safe-area padding around the brand mark. |

### Manifest entries (`vite.config.ts`)

```js
{
  name: 'AppGrav - The Breakery POS',
  short_name: 'AppGrav',
  theme_color: '#0f172a',          // PWA chrome color (dark slate)
  background_color: '#0f172a',     // splash background
  display: 'standalone',
  display_override: ['window-controls-overlay'],
  start_url: '/pos',
  scope: '/',
  icons: [
    { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Point of Sale', short_name: 'POS', url: '/pos', icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }] },
    { name: 'Kitchen Display', short_name: 'KDS', url: '/kds', icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }] },
  ],
}
```

> **Note**: `theme_color` is `#0f172a` (Tailwind `slate-950`) for the PWA chrome — this differs from the in-app `--surface-0` (`#0C0C0E`) because `slate-950` is the historical default chosen during initial PWA setup. Both are dark; the difference is invisible in practice. Aligning these is a low-priority cleanup item.

### Apple-specific meta (in `index.html`)

```html
<meta name="theme-color" content="#0f172a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/pwa-192x192.png">
```

`black-translucent` lets the app extend behind the iOS status bar — the safe-area padding in headers ([07-responsive-mobile.md](./07-responsive-mobile.md)) handles the visual offset.

---

## 4. Favicon

The app does **not** ship a separate `favicon.ico`. The PWA plugin lists `'favicon.ico'` in `includeAssets` but no file is currently committed at `public/favicon.ico`. Browsers fall back to the apple-touch-icon (`/pwa-192x192.png`) declared in the head.

> Adding a real `favicon.ico` (or SVG favicon) is recommended — see backlog item in `CURRENT_STATE.md`.

---

## 5. Static Pages

| File | Purpose |
|---|---|
| [`public/offline.html`](../../../public/offline.html) | Service-worker fallback for hard-offline navigation. Served by `vite-plugin-pwa`'s Workbox config; minimal HTML with brand mark and "You are offline" message. |
| [`public/robots.txt`](../../../public/robots.txt) | Crawler directives. The app is behind auth so SEO is not a concern. |

---

## 6. Illustration Strategy

The Luxe Dark aesthetic deliberately **avoids illustrations**:

- **No mascots.** The brand voice is restrained / Parisian, not playful.
- **No spot illustrations on empty states** — instead, a single Lucide outline icon at low opacity (`opacity-30`) with a tracked-3em uppercase micro-label (e.g., the "Empty Bag" pattern in the Cart).
- **Dashboard hero space** prefers tracked typography and KPI cards over illustration.

The single exception is `croissant.svg`, retained for potential future use (loading splash, marketing PWA install banner) but not currently rendered in production.

---

## 7. Snippet — Empty State Icon Treatment

```tsx
import { ShoppingCart } from 'lucide-react';

<div className="h-full flex flex-col items-center justify-center text-content-muted">
  <ShoppingCart size={48} strokeWidth={1} className="mb-4 opacity-30" />
  <span className="text-[10px] uppercase font-bold tracking-[0.3em] opacity-30">
    Empty Bag
  </span>
  <span className="text-xs mt-2 opacity-50">Select products to begin</span>
</div>
```

This is the canonical empty-state pattern. Reuse it across modules — change only the icon and label.

---

## 8. References

- Lucide library: https://lucide.dev/icons/
- vite-plugin-pwa: https://vite-pwa-org.netlify.app/
- For responsive icon sizing on mobile / tablet, see [07-responsive-mobile.md](./07-responsive-mobile.md).
