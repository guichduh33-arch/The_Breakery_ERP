# The Breakery UI — build conventions

React 18 components from `@breakery/ui` (window.BreakeryUI). POS/ERP for a bakery-café in Indonesia (currency `Rp`, format `Rp 4,850,000`).

## Setup & theming — no provider needed

Components work standalone; tokens live on `:root` (default = **POS "luxe-dark"**: dark surfaces + gold accents). Every screen sits on a wrapper:

```jsx
<div className="bg-bg-base text-text-primary min-h-screen">…</div>
```

For the **Backoffice** (light "ivoire" enterprise look), add `theme-backoffice` to that wrapper — same components, tokens remap (body font becomes IBM Plex Sans, display serif is dropped). Mount `<Toaster />` once per app for toasts. `VirtualKeypadProvider` is only needed around screens using `useVirtualKeypad`.

## Styling idiom — token-backed Tailwind utilities, never hex

All styling is Tailwind utility classes whose values are CSS variables. Never hardcode hex colors and never use raw Tailwind palette names (`bg-zinc-800`, `text-red-500`) — use these families (shipped precompiled in `styles.css`; rendered designs have no JIT, so stick to this vocabulary and the layout core: flex/grid, `gap|p|m-0..16`, `w|h-…`, `items|justify-*`):

| Family | Utilities |
|---|---|
| Surfaces | `bg-bg-base` `bg-bg-elevated` `bg-bg-overlay` `bg-bg-input`, scale `bg-surface-0`…`bg-surface-4` |
| Text | `text-text-primary` `text-text-secondary` `text-text-muted` `text-text-subtle` `text-text-disabled` |
| Borders | `border-border-subtle` `border-border-strong` `border-border-focus` `border-border-muted` `border-border-gold` |
| Brand gold | `bg-gold` `bg-gold-soft` `text-gold` `text-gold-fg` (accents, active tabs — NOT primary CTAs) |
| Semantic | `bg-success-soft text-success`, same for `warning` / `danger` / `info` (the canonical status chip recipe) |
| Money-path | `Button variant="primary"` is GREEN by design (confirm/pay); payment hues `bg-payment-cash|card|qris|voucher` |
| Categorical | `bg-cat-amber/15 border-cat-amber/30` … 12 hues (`cat-yellow`, `cat-blue`, `cat-rose`, …) for identity chips |
| Type | `font-body` (Inter — all chrome), `font-display` (Playfair — hero/branding only), `font-data` (Fraunces — KPI values), `font-mono` (JetBrains Mono — amounts, SKU, timers); sizes `text-xs`…`text-3xl`, `text-display` |
| Labels | SectionLabel pattern = `text-xs uppercase tracking-widest text-text-muted` (or use `SectionLabel`) |
| Radius/shadow | `rounded-sm|md|lg|xl|2xl`, `shadow-xs`…`shadow-xl`, `shadow-modal`, `shadow-inset-sm|md`, `shadow-focus` |
| Touch/spacing | min tap target `h-touch-min` (44px), `h-touch-comfy`, `h-touch-large`; gutters `p-gutter-card|page|section` |
| Motion | `transition-colors duration-base ease-motion-out`, `duration-fast|slow` |

## Where the truth lives

Read `styles.css` and its imports (`_ds_bundle.css` defines every `--token`; `fonts/fonts.css` the @font-faces) before inventing a value. Each component's API is its `components/<group>/<Name>/<Name>.d.ts`; usage patterns are in `<Name>.prompt.md`.

## Idiomatic example

```jsx
<div className="bg-bg-base text-text-primary p-gutter-page min-h-screen">
  <Card variant="elevated" className="w-96">
    <CardHeader>
      <CardTitle>Order #A-0139</CardTitle>
      <CardDescription>Take-out · cashier Ni Luh</CardDescription>
    </CardHeader>
    <CardContent className="flex items-center justify-between">
      <span className="text-sm text-text-secondary">2× Pain au chocolat</span>
      <span className="font-mono">Rp 64,000</span>
    </CardContent>
    <CardFooter className="justify-between">
      <Badge variant="success">Paid</Badge>
      <Button variant="primary" size="lg">Print receipt</Button>
    </CardFooter>
  </Card>
</div>
```
