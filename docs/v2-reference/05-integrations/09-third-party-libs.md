# 09 — Third-Party Libraries

> **Last verified**: 2026-05-03

This page catalogues the secondary runtime dependencies — the ones not deep enough to warrant their own integration document but load-bearing in day-to-day UI code. For Supabase, Sentry, Capacitor, jsPDF, xlsx, Anthropic SDK, and PWA, see the dedicated pages in this folder.

## Versions

All versions verified against `package.json` on 2026-05-03.

| Library | Version | Category |
|---------|---------|----------|
| `date-fns` | `^4.1.0` | Dates |
| `recharts` | `^3.6.0` | Charts |
| `@dnd-kit/core` | `^6.3.1` | Drag and drop |
| `@dnd-kit/sortable` | `^10.0.0` | Drag and drop |
| `@dnd-kit/utilities` | `^3.2.2` | Drag and drop |
| `sonner` | `^2.0.7` | Toasts |
| `cmdk` | `^1.1.1` | Command palette |
| `react-day-picker` | `^9.13.0` | Date picker |
| `lucide-react` | `^0.303.0` | Icons |
| `class-variance-authority` | `^0.7.1` | Variant API |
| `clsx` | `^2.1.1` | Class composition |
| `tailwind-merge` | `^3.4.0` | Tailwind dedup |
| `tailwindcss-animate` | `^1.0.7` | Animation utilities |
| `next-themes` | `^0.4.6` | Theme provider |
| `dotenv` | `^17.2.3` | Scripts only |

> Radix UI primitives (`@radix-ui/react-*`) ship the shadcn/ui components — see `02-design-system/03-shadcn-primitives.md`.

---

## date-fns 4.1.0

Used for every date format / parse / arithmetic operation in the app. Locale is fixed to `enUS` (i18n suspended).

```ts
import { format, parseISO, differenceInDays, startOfDay, endOfDay } from 'date-fns'
import { enUS } from 'date-fns/locale'

format(new Date(), 'dd/MM/yyyy HH:mm', { locale: enUS })
```

**Conventions**

- Always import functions individually (tree-shakeable).
- `Intl.DateTimeFormat` is reserved for currency-style locale formatting (`Intl.NumberFormat('id-ID', ...)`) — date display uses date-fns.
- Date pickers and report exports always use `dd/MM/yyyy` (Indonesian convention).

---

## Recharts 3.6.0

Single charting library — used in 47+ reports. Bundled with `vendor-react` (merged with d3 to avoid circular chunk loops; see `vite.config.ts → manualChunks`).

| Chart type | Where used |
|------------|------------|
| `LineChart` / `Area` | Sales trends, hourly orders |
| `BarChart` | Product rankings, payment breakdown |
| `PieChart` | Category share, payment-method split |
| `ComposedChart` | Multi-axis dashboards (revenue + orders) |

**Conventions**

- Wrap charts in `<ResponsiveContainer width="100%" height={300}>`.
- Tooltips use `<Tooltip formatter={formatCurrency} labelFormatter={formatDate} />`.
- Theme: charts inherit Tailwind tokens via inline styles (`stroke="hsl(var(--primary))"`); avoid hard-coded hex.
- Axis ticks: `interval="preserveStartEnd"` to dodge crowding.

---

## @dnd-kit (core 6.3.1, sortable 10.0.0, utilities 3.2.2)

Drag-and-drop primitives — replaces react-beautiful-dnd (deprecated). Used in:

| Module | Use case |
|--------|----------|
| KDS | Re-order tickets within a station |
| Product catalogue | Drag products between categories |
| Modifier groups | Reorder modifier options |
| Tablet ordering | Reorder cart items |

**Patterns**

- Wrap area in `<DndContext sensors={sensors} onDragEnd={...}>`.
- Use `<SortableContext items={ids}>` + `useSortable({ id })` per item.
- `KeyboardSensor` is mandatory for accessibility (WCAG 2.1.1).

```ts
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
)
```

---

## Sonner 2.0.7

Toast notifications. Single `<Toaster />` mounted at app root; called via `toast.*` from anywhere.

```ts
import { toast } from 'sonner'

toast.success('Order completed', { description: `#${order.order_number}` })
toast.error('Payment failed', { action: { label: 'Retry', onClick: retry } })
toast.promise(savePromise, {
  loading: 'Saving...',
  success: 'Saved',
  error: (err) => `Failed: ${err.message}`,
})
```

**Conventions**

- Position: top-right (default for desktop POS).
- Duration: 4 s for `success`/`info`, indefinite for `error` (cashier must dismiss).
- No raw `alert()` / `confirm()` anywhere — replaced by Sonner + `<AlertDialog>`.

---

## cmdk 1.1.1

Command palette + combobox primitive used by shadcn `<Command>`.

> **Pitfall (epic-016b retrospective)**: `cmdk`'s `Command` defaults `shouldFilter={true}` — fine for client-side filtering, but breaks any consumer that drives results from a server query (e.g. Supabase async search). When a `<CommandItem value="...">` doesn't substring-match the input, cmdk hides it.
>
> **Fix**: pass `shouldFilter={false}` and let `value` only drive selection / keyboard nav.

```tsx
<Command shouldFilter={false}>
  <CommandInput value={query} onValueChange={setQuery} />
  <CommandList>
    {results.map(r => <CommandItem key={r.id} value={r.id}>{r.label}</CommandItem>)}
  </CommandList>
</Command>
```

Used in: global search (Cmd-K), product picker, customer search, supplier picker.

---

## react-day-picker 9.13.0

Calendar primitive behind shadcn `<Calendar>`. Used by every date-range filter (reports, orders, expenses, accounting).

**Patterns**

- Range mode: `<DayPicker mode="range" selected={range} onSelect={setRange} numberOfMonths={2} />`.
- Locale: `enUS` (date-fns locale interops directly).
- Disabled days: `disabled={{ after: new Date() }}` for any "from" picker that must be in the past.

---

## lucide-react 0.303.0

Sole icon library. ~1500 icons; tree-shaken to ~3 % of total at build time.

```tsx
import { ShoppingCart, Trash2, Receipt } from 'lucide-react'
<ShoppingCart className="h-4 w-4" />
```

**Conventions**

- Default size: `h-4 w-4` (16 px). Headers use `h-5 w-5`. Avoid custom widths.
- `strokeWidth={2}` is the default; use `1.5` for "soft" variants in tab bars.
- Never use raw SVG — every icon must come from Lucide for consistency.

---

## class-variance-authority + clsx + tailwind-merge

The classic "shadcn trio" for composing Tailwind classes safely.

```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```

| Library | Role |
|---------|------|
| `clsx` | Conditional class composition (cheap) |
| `tailwind-merge` | Dedup conflicting Tailwind classes (`bg-red-500 bg-blue-500` → `bg-blue-500`) |
| `class-variance-authority` (`cva`) | Typed variant prop API for buttons, badges, alerts |

`cva` example (used in every shadcn primitive):

```ts
const buttonVariants = cva('inline-flex items-center ...', {
  variants: {
    variant: { default: '...', destructive: '...', ghost: '...' },
    size: { sm: 'h-8 px-3', md: 'h-10 px-4', lg: 'h-12 px-6' },
  },
  defaultVariants: { variant: 'default', size: 'md' },
})
```

---

## tailwindcss-animate 1.0.7

Plugin that adds keyframes used by Radix-based primitives (`<Dialog>`, `<Toast>`, `<Tooltip>`). Required by shadcn/ui — do not remove. Its presence in `tailwind.config.ts` is what makes `data-[state=open]:animate-in` actually animate.

---

## next-themes 0.4.6

Theme provider for dark/light. V2 is **dark-only** in production (Luxe Dark) — `next-themes` is mounted with `defaultTheme="dark" forcedTheme="dark"`. Kept around so the eventual light-mode story has a one-line wiring point.

---

## dotenv 17.2.3

Used **only** by helper scripts in `scripts/` (never at runtime — Vite handles `.env` natively for the app).

```ts
// scripts/run-audit.ts
import 'dotenv/config'
const url = process.env.VITE_SUPABASE_URL
```

---

## Bundle chunk assignments (recap)

| Chunk | Members |
|-------|---------|
| `vendor-react` | React, react-dom, react-router, @tanstack/react-query, recharts + d3, redux/immer (transitive), clsx, decimal.js |
| `vendor-supabase` | `@supabase/supabase-js` |
| `vendor-pdf` | `jspdf`, `jspdf-autotable` |
| `vendor-xlsx` | `xlsx-js-style` |
| `vendor-ui` | `lucide-react`, `sonner`, `@radix-ui/*`, `tailwind-merge`, `class-variance-authority`, scroll lock helpers |

Source: `vite.config.ts → rollupOptions.output.manualChunks`.

## Lib-by-module quick reference

| Module | Notable libs |
|--------|--------------|
| POS terminal | sonner, cmdk, lucide, dnd-kit (cart reorder) |
| Reports | recharts, jspdf, xlsx-js-style, date-fns, react-day-picker |
| KDS | dnd-kit, sonner, recharts (overview) |
| Accounting | recharts (statements), date-fns, jspdf |
| Settings | cmdk (search), lucide |
| Inventory | xlsx-js-style (opname), dnd-kit (categories) |

## Cross-references

- Design tokens + component primitives: `02-design-system/`
- Bundle splitting / vite manual chunks: `10-deployment-ops/02-vite-build.md`
- cmdk pitfall epic context: `_bmad/output/implementation-artifacts/epic-016b/`
- Lazy-loading patterns: `01-architecture/02-lazy-routes.md`
