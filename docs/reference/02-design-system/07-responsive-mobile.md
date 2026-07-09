<!-- STALE-V2 -->
> ⚠️ **DOC HISTORIQUE — PÉRIMÉE (V2), NE FAIT PLUS FOI.** Ce fichier décrit en grande partie l'architecture **V2** (mono-app AppGrav, npm/Vercel, PWA/Capacitor, projet Supabase `abjabuniwkqpfsenxljp` = **prod incompatible**, versions RPC obsolètes). **Ne jamais l'appliquer tel quel** (migration, config, archi). Sources de vérité actuelles : `CLAUDE.md` (patterns + workplan) et `docs/workplan/remise-a-plat/` (référence modules réel-vs-demandé). Hiérarchie complète : `docs/README.md`. Régénération depuis le code prévue en Phase 3.

# 07 — Responsive & Mobile

> **Last verified**: 2026-05-03
> **Sources**: [`tailwind.config.js`](../../../tailwind.config.js), [`vite.config.ts`](../../../vite.config.ts), [`index.html`](../../../index.html), [`src/components/mobile/MobileLayout.tsx`](../../../src/components/mobile/MobileLayout.tsx), [`src/pages/mobile/`](../../../src/pages/mobile/)

AppGrav V2 runs on multiple form factors: a 22" cashier touchscreen, a 10" tablet for waiters, a 5–7" Android phone for managers, and traditional laptops/monitors for back-office work. This document covers how the design system stretches across all of them.

---

## 1. Breakpoints (Tailwind defaults)

| Token | Min-width | Typical device | What changes here |
|---|---|---|---|
| `sm` | `640px` | Phone landscape | First meaningful column transitions in mobile pages |
| `md` | `768px` | Tablet portrait, large phone landscape | BackOffice sidebar appears (below `md` it is a hamburger drawer) |
| `lg` | `1024px` | Tablet landscape, small laptop | KDS grid switches to 3 columns |
| `xl` | `1280px` | POS terminal, standard desktop | POS Cart locks to `w-[480px]` as a fixed third column |
| `2xl` | `1536px` | Wide desktop, dual-monitor cashier | Reports dashboards may add a 4th KPI per row |

No custom breakpoints are defined — Tailwind defaults are sufficient.

---

## 2. Touch Targets

The app follows **WCAG 2.2 AA** for touch targets and Indonesian POS hardware ergonomics:

| Surface | Minimum target | How it is enforced |
|---|---|---|
| **POS terminal** (22" touchscreen) | 44 × 44 px (most are larger — 64+) | `Button` `xl` size = `h-12`, `pos-pay` = `h-14`; product tiles are `aspect-square` ≥ 120px |
| **Tablet** | 44 × 44 px | Bottom-sheet controls min `min-h-[48px]`; nav items min `h-12` |
| **Mobile** | 44 × 44 px | Action buttons `min-h-[48px]` to `min-h-[56px]` (see `MobileHomePage.tsx:114`); FAB `w-14 h-14` |
| **Back-office (mouse)** | 32 × 32 px | shadcn `Button` `sm` = `h-8`; `default` = `h-9` |

```tsx
// Mobile primary action — see MobileHomePage.tsx
<button className="flex items-center gap-lg py-lg px-xl bg-gold border-none rounded-xl text-base font-semibold text-black cursor-pointer transition-all duration-fast min-h-[56px] active:brightness-90 active:scale-[0.98]">
  Start order
</button>

// Mobile secondary action
<button className="… min-h-[48px] active:bg-surface-2 active:scale-[0.98]">
  …
</button>
```

The `active:scale-[0.98]` micro-press feedback compensates for the lack of hover on touch.

---

## 3. Desktop ↔ Mobile Transformations

| Pattern | Desktop | Mobile |
|---|---|---|
| **Sidebar** | Permanent `w-64` (BackOffice) / `w-24` (POS) | Hamburger toggle → fixed `Sheet` from left with backdrop |
| **Table** | Sticky-header `<table>` with horizontal scroll if needed | Card list — each row becomes a stacked `Card` with label-value pairs |
| **Filter bar** | Inline `ReportFilters` row above the chart | Bottom `Sheet` triggered by a "Filters" button |
| **Modal `Dialog`** | Centered `max-w-lg` with backdrop | Full-bleed `Sheet` from bottom (mobile pages directly use `<div className="… animate-slide-up rounded-t-2xl">`) |
| **Three-column POS** | Nav (w-24) + Grid (flex-1) + Cart (w-[480px]) at `xl:` | Below `xl`: cart drops below grid; below `md`: full-screen single-column flow |
| **KDS grid** | 4 columns (`xl:grid-cols-4`) | 1 column (`grid-cols-1`) |
| **Forms** | 2-column grid of fields (`md:grid-cols-2`) | Single column, stacked |
| **Date range picker** | Popover with two calendars side-by-side | Stacked vertical, full-width |

All transformations rely on **Tailwind responsive prefixes** (`md:`, `lg:`, `xl:`) — no JavaScript media-query branching is needed for layout.

---

## 4. Capacitor (Native Android)

| Detail | Value |
|---|---|
| Package | `@capacitor/core ^7.5` |
| Build trigger | `CAPACITOR_BUILD=true` env var (read in `vite.config.ts:22`) |
| Base path override | `base: './'` (file:// protocol) when `isCapacitor` |
| PWA disabled | `vite-plugin-pwa` is conditionally excluded in Capacitor builds because Service Workers conflict with the native WebView |
| Platform env hint | `VITE_PLATFORM=android` declared in `.env.android` (informational; consumed by feature flags where needed) |
| Build command | `npm run android:build` (delegates to Capacitor CLI + Android Gradle) |

### Capacitor-aware patterns

- **`@capacitor/keyboard` plugin** — pushes content up when the soft keyboard opens. The Cart and forms use `pb-[calc(1rem+env(safe-area-inset-bottom))]` so the gold "Pay" button stays clear of the keyboard.
- **`@capacitor/status-bar`** — set to dark style so the OS status bar matches `.theme-pos`.
- **No Service Worker** — Workbox/PWA caching is disabled; assets are bundled into the APK via Capacitor sync.

---

## 5. Safe-Area Insets (iOS notch / Android gesture bar)

The app uses CSS environment variables `env(safe-area-inset-top|bottom|left|right)` everywhere it touches the screen edge.

### Required `<meta>` for safe-area to work

```html
<!-- index.html -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

`viewport-fit=cover` is what enables `env(safe-area-inset-*)` to return non-zero values on notched devices.

### Real usages in the codebase

| Location | Class | Purpose |
|---|---|---|
| [`MobileLayout.tsx:71`](../../../src/components/mobile/MobileLayout.tsx#L71) | `supports-[padding:env(safe-area-inset-top)]:pt-[calc(0.5rem+env(safe-area-inset-top))]` | Push header below iOS notch |
| [`MobileLayout.tsx:85`](../../../src/components/mobile/MobileLayout.tsx#L85) | `pb-[env(safe-area-inset-bottom,0)]` | Bottom padding on `<main>` |
| [`MobileLayout.tsx:90`](../../../src/components/mobile/MobileLayout.tsx#L90) | `pb-[env(safe-area-inset-bottom,0)]` | Bottom-nav clearance for home indicator |
| [`CartActions.tsx:26`](../../../src/components/pos/cart-components/CartActions.tsx#L26) | `pb-[calc(1rem+env(safe-area-inset-bottom))]` | Pay button stays above iPad home indicator |
| [`MobileCartPage.tsx:265`](../../../src/pages/mobile/MobileCartPage.tsx#L265) | `pb-[calc(1rem+env(safe-area-inset-bottom,0px))]` | Bottom action bar |
| [`MobileCatalogPage.tsx:280`](../../../src/pages/mobile/MobileCatalogPage.tsx#L280) | `bottom-[calc(72px+1rem+env(safe-area-inset-bottom,0px))]` | FAB clears the bottom-nav AND home indicator |

**Convention**: always use `env(safe-area-inset-*, 0)` (with the `0` fallback) so non-mobile contexts return `0` instead of failing.

---

## 6. Mobile Patterns

### 6.1 Bottom navigation

Tab bar at the bottom of `MobileLayout`. 4–5 tabs, equal width (`flex-1`), Lucide icon (size 18–20) above a 10–12px label. Active tab: `text-gold`. Wrapper applies safe-area padding.

### 6.2 Slide-up bottom sheets

Modals on mobile are rendered as bottom sheets, not centered dialogs:

```tsx
<div className="fixed inset-0 z-modal flex items-end bg-black/60">
  <div className="w-full bg-surface-1 rounded-t-2xl p-xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] animate-slide-up max-h-[80vh] overflow-y-auto">
    {children}
  </div>
</div>
```

The `animate-slide-up` keyframe is registered in [`tailwind.config.js:230-233`](../../../tailwind.config.js#L230).

### 6.3 Active press feedback

`active:scale-[0.98]` and `active:brightness-90` are applied to every primary tap target — replaces hover for touch.

### 6.4 Pull-to-refresh

Not implemented (the app uses react-query auto-refetch on focus). Avoid relying on PTR.

---

## 7. Test Sizes (Chrome DevTools)

When validating responsive behavior, hit these representative resolutions:

| Device class | Width × Height | Notes |
|---|---|---|
| **POS terminal** | `1366 × 768` (or `1920 × 1080`) | Cashier touchscreen — three-column lock active at `xl:` |
| **Wide desktop** | `1920 × 1080` | Manager workstation |
| **Laptop** | `1440 × 900` | Standard MacBook / laptop |
| **Tablet landscape** | `1024 × 768` (iPad) | Tablet waiter mode |
| **Tablet portrait** | `768 × 1024` | Just above the `md:` breakpoint |
| **Phone large** | `390 × 844` (iPhone 12+) | Mobile manager view |
| **Phone small** | `360 × 640` (Galaxy S5 baseline) | Floor of the responsive design |

All operational pages should be checked at `1366 × 768` (the most common in-store hardware) and `390 × 844` (the most common manager phone).

---

## 8. PWA Install Prompt

- **Trigger**: `vite-plugin-pwa` registers the service worker in `autoUpdate` mode. Browsers show the install prompt automatically when criteria are met (HTTPS, manifest valid, user has visited twice with > 5 min between visits).
- **Standalone mode**: `display: 'standalone'` in the manifest hides the browser chrome once installed.
- **`window-controls-overlay`**: declared in `display_override` so on Chromium desktop, the title bar can be claimed for app UI.
- **Start URL**: `/pos` — installing from a phone or terminal opens directly to the cashier flow.
- **Shortcuts**: long-press the installed icon to access POS / KDS shortcuts (defined in `vite.config.ts:62-77`).
- **Manual install**: there is no in-app "Install AppGrav" button — installation is left to the OS prompt to avoid intrusion.

---

## 9. Reduced Motion & Accessibility

- **`prefers-reduced-motion: reduce`** — global rule in [`src/styles/index.css`](../../../src/styles/index.css) collapses every animation and transition to `0.01ms`.
- **Per-component opt-out** — many KDS / mobile pulse animations also apply `motion-reduce:animate-none` explicitly (e.g., `KDSOrderCard.tsx:141`).
- **Focus visibility** — every interactive control gets a 3px solid `--gold` outline with 2px offset in `:focus-visible`. Buttons add a gold glow shadow.
- **Skip link** — `BackOfficeLayout` includes `<a href="#main-content" className="sr-only focus:not-sr-only">`.
- **High contrast mode** — borders thicken to 2–3px, shadows are removed, gold darkens for legibility.

---

## 10. Quick Diagnostic Checklist

When a new screen behaves badly responsively, walk this list:

- [ ] Does the root use `h-[100dvh]` (not `h-screen`)?
- [ ] Is `overflow-hidden` set so only named panels scroll?
- [ ] Are mobile gestures interrupted by missing `safe-area-inset-bottom` padding?
- [ ] Are tap targets at least `min-h-[44px]`?
- [ ] Does the page degrade gracefully below `md` (single column)?
- [ ] Is the form a `Sheet` on mobile and a `Dialog` on desktop?
- [ ] Are tables collapsing into card lists below `md`?
- [ ] Are animations honoring `motion-reduce:`?
- [ ] Does Chrome DevTools at `390 × 844` show no horizontal scroll?
- [ ] Does Chrome DevTools at `1366 × 768` lock the POS three-column layout?

For tokens used in any of the above patterns, see [02-tokens.md](./02-tokens.md). For the underlying component library, see [03-shadcn-primitives.md](./03-shadcn-primitives.md). For per-surface layout details, see [05-layouts.md](./05-layouts.md).
