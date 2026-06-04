# Session 13 — Phase 4.D — Tablet polish + ui-steward batch 2

**Date opened:** 2026-05-14
**Status:** in-progress
**Wave:** 4 (cross-cutting UX hardening)
**Complexity:** L — UI-only, no migrations

---

## Goal

Two independent UI-only deliverables landing in the same phase:

1. **Tablet polish** — make the kiosk-style waiter tablet flow degrade gracefully when the
   network or realtime layer hiccups (offline menu cache, ready-event ordering tolerance,
   user-visible offline banner).
2. **ui-steward batch 2** — migrate the remaining ad-hoc backoffice modals (the ones that
   still hand-roll their own `fixed inset-0 z-50 bg-black/40` overlays) to the `@breakery/ui`
   Radix `Dialog` primitive shipped in Phase 1.D.

No database work. No new edge functions. No new dependencies (Radix Dialog already on disk).

---

## Part 1 — Tablet polish

### Files

| File | Action | Purpose |
|---|---|---|
| `apps/pos/src/features/tablet/hooks/useTabletOffline.ts` | **create** | `navigator.onLine` + lightweight Supabase auth ping → `{ isOnline, lastSync }`. |
| `apps/pos/src/features/tablet/hooks/useTabletMenuCache.ts` | **create** | localStorage (cheap, no IndexedDB ceremony) cache of `categories + products` with TTL + version stamp. Falls back from live query on offline. |
| `apps/pos/src/features/tablet/components/OfflineBanner.tsx` | **create** | Slim banner under the tablet header — appears when `!isOnline`, surfaces last successful sync time. |
| `apps/pos/src/features/tablet/components/TabletMenuView.tsx` | **create** | Wraps the category sidebar + grid so the cached snapshot can be served when offline. New file because today the menu is composed inline in `pages/tablet/TabletOrderPage.tsx` — extracting the seam is the cleanest place to graft cache-or-live logic. |
| `apps/pos/src/pages/tablet/TabletOrderPage.tsx` | **edit** | Render `OfflineBanner` + delegate menu rendering to `TabletMenuView`. |
| `apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts` | **edit** | Use a `Set<string>` of seen `(order_id,item_index,kitchen_status)` keys so out-of-order realtime events don't double-fire toasts. |

> Note on `TabletOrderTimeline.tsx`: the spec called for hardening this component, but it
> doesn't exist in the V3 tree (tablet "orders" page just renders a list of
> `TabletOrderCard`). The realtime event handler that drives those cards is
> `useTabletOrderStatusListener.ts` — that's where the de-duping lives.

### Tests

`apps/pos/src/features/tablet/__tests__/TabletOffline.test.tsx` covering:

- `useTabletOffline` flips `isOnline` when `online`/`offline` events fire.
- `useTabletMenuCache` returns cached menu when network is down, refreshes when back online.
- `OfflineBanner` renders the offline pill + `Last synced` label when `!isOnline`.

### Acceptance

- Cached menu accessible when `navigator.onLine === false` (no spinner, no error wall).
- Offline banner visible above the menu grid.
- Duplicate realtime events do not double-toast.

---

## Part 2 — ui-steward batch 2 (BO modal migration)

### Discovery (done — see §3)

`grep`-confirmed the full list of `apps/backoffice/src/features/**/*{Modal,Dialog,Confirm,Drawer}.tsx`
files. 25 files total. **15 already use `Dialog` from `@breakery/ui`**. **10 still hand-roll
their own modal overlay** (the migration candidates).

Charter §3.2 already documented that V3 modals are mostly Radix-based and the spec D9
"≈24 per batch" was overstated. This phase migrates the **10 remaining ad-hoc modals** to
`<Dialog>` from `@breakery/ui`. The final count will be recorded in the wave 3 deviation
pack as `D-W4-4D-NN`.

### Migration list — the 10 ad-hoc files

| # | File | Pattern today | Notes |
|---|---|---|---|
| 1 | `apps/backoffice/src/features/inventory-opname/components/CreateOpnameModal.tsx` | `<div className="fixed inset-0 ...">` | Single confirm form. |
| 2 | `apps/backoffice/src/features/inventory-opname/components/FinalizeOpnameDialog.tsx` | ditto | Confirmation + variance preview. |
| 3 | `apps/backoffice/src/features/inventory-opname/components/CancelOpnameDialog.tsx` | ditto | Mandatory reason. |
| 4 | `apps/backoffice/src/features/inventory-production/components/RevertProductionDialog.tsx` | ditto | Reason + admin-only error UI. |
| 5 | `apps/backoffice/src/features/sections/components/SectionFormModal.tsx` | ditto | CRUD form. |
| 6 | `apps/backoffice/src/features/purchasing/components/ReceiveDialog.tsx` | ditto | Larger; table-driven receive flow. |
| 7 | `apps/backoffice/src/features/purchasing/components/CancelDialog.tsx` | ditto | Reason + ghostDestructive. |

That's 7 ad-hoc files. Three more candidates were inspected and are **already** Dialog-based
(false positives in the initial grep) — they're left untouched:

| # | File | State |
|---|---|---|
| 8 | `apps/backoffice/src/features/expenses/components/ApproveDialog.tsx` | already `<Dialog>` from `@breakery/ui` |
| 9 | `apps/backoffice/src/features/expenses/components/PayDialog.tsx` | already `<Dialog>` |
| 10 | `apps/backoffice/src/features/expenses/components/RejectDialog.tsx` | already `<Dialog>` |

So **7 actual migrations**, not 24. Final deviation entry: `D-W4-4D-01` documents the variance
between spec ("24 modals") and reality (7 ad-hoc remaining).

### Migration pattern

Each ad-hoc modal moves from:

```tsx
<div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
     role="dialog" aria-modal="true">
  <div className="bg-bg-elevated rounded-md ... w-full max-w-md p-5 ...">
    <h3 className="text-lg font-serif mb-3">…</h3>
    {/* form */}
    <div className="flex justify-end gap-2"><Button>Cancel</Button><Button>Save</Button></div>
  </div>
</div>
```

to:

```tsx
<Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>…</DialogTitle>
      <DialogDescription className="sr-only">…</DialogDescription>
    </DialogHeader>
    {/* form */}
    <DialogFooter><Button>Cancel</Button><Button>Save</Button></DialogFooter>
  </DialogContent>
</Dialog>
```

A11y wins handed back by Radix:

- Focus trap (Radix Dialog manages tabbable scope).
- `Escape` closes (Radix listens).
- `aria-labelledby` wired from `<DialogTitle>`.
- `aria-describedby` wired from `<DialogDescription>` (use `sr-only` if not visually shown).
- Focus returns to trigger on close.
- Backdrop blur + motion-reduce variants (Phase 1.D already added these).

### Callers

All seven modals are conditionally rendered by their parents using
`{state && <Modal onClose={…} />}`. After migration they keep the same prop surface (no
breaking change) — just the Radix Dialog gets a wrapping `open`/`onOpenChange`. Where
parents pass `open: boolean` already (PO / opname pages drive this themselves), we keep the
existing semantics by binding `open` to the truthy-check the parent currently does. For
files whose parent does `{showX && <X onClose={...} />}`, the migrated component takes a
synthetic `open={true}` (mount-controlled) — same UX, idiomatic Radix usage.

### Tests

Each migrated file has either no existing test or smoke tests that assert role/text rather
than DOM containment, so the migration is test-compatible. Where assertions used
`document.body.contains(...)` we'd flip to `getByRole('dialog')`, but a grep found no such
pattern in the seven files' associated tests. After the migration we re-run the full BO
suite and confirm no regressions vs the baseline.

---

## Sequencing

1. Sub-plan (this file). ✓ committed alone.
2. Tablet part — three new files, two edits. One commit.
3. Modal migration — per feature group:
   - Opname (3 files) — one commit.
   - Production (1 file) — folded with opname commit if low-risk.
   - Sections (1 file) — own commit.
   - Purchasing (2 files) — one commit.
4. Run `pnpm --filter @breakery/app-backoffice test` after each group ; surface regressions
   immediately.
5. Final `pnpm typecheck`, full BO + POS test suites.
6. Update `2026-05-14-session-13-wave-3-deviations.md` with `D-W4-4D-01`.

## DoD

- [ ] Tablet offline cached menu accessible, banner visible (3 new files + 2 edits).
- [ ] 7 BO modals migrated to Radix `Dialog`.
- [ ] BO smoke tests still green (no new failures vs the 3 pre-existing
  `inventory.smoke.test.tsx` failures unrelated to this phase).
- [ ] `pnpm typecheck` green.
- [ ] Commits squash-mergeable + Claude co-author.
- [ ] Deviation `D-W4-4D-01` filed.
