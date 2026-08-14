// apps/pos/src/features/kds/components/KdsOrderCard.tsx
//
// Session 14 / Phase 3.A — Live order tile (KDS station view).
//
// Refs (docs/Design/backoffice):
//   - `kds configue.jpg`  — Warning Threshold = 300s (amber), Urgent Threshold
//     = 600s (red). Sourced from the BO "KDS Configuration" panel; mirrored
//     here as the on-screen ageing bands so the card colours match what
//     operators configure in BO.
//   - `live order.jpg`    — Order number rendered in gold tabular mono with a
//     `#` prefix; ticket chrome is bg-bg-elevated with a 2px coloured border
//     that escalates with age.
//   - `live order2.jpg`   — Modifier sub-lines in text-text-secondary, item
//     rows separated by a hairline; cancelled rows shown struck-through with
//     a "Cancelled" badge and reason in red.
//
// Timers use JetBrains Mono via `font-mono` (token --font-mono, D3) and
// `tabular-nums` so MM:SS digits don't jitter as they tick.
//
// CTA wiring (Start / Bump Ready / Mark Served / Cancelled badge) preserved
// from session 13 — the page-level rewrite (KdsBoard) only changes layout
// chrome, not the bump/serve flow.
//
// Session 59 (04 D1.1 / D1.3) — Start now calls the server RPC
// `kds_start_prep_timer_v1` (sets `prep_started_at`) instead of the raw
// table PATCH, and "Bump Ready" is replaced by `BumpButton`, which wraps
// `kds_bump_item_v2` and surfaces a 60s `UndoBumpToast`. The PrepTimer shows
// once an item has actually been started (`prep_started_at` set).
//
// Constraints:
//   - Zero hardcoded hex (D-color). All colours flow through tokens via
//     Tailwind preset (`bg-bg-elevated`, `text-text-primary`, `border-red`,
//     `border-amber-warn`, `text-amber-warn`, `text-red`, `text-gold`, …).
//   - No raw `style={{}}` — Tailwind classes only.
//   - StrictMode-safe — no module-scoped mutable state ; the only timer is
//     the shared `useAgeTimer` hook.

import { Button, Badge } from '@breakery/ui';
import { orderTypeLabel } from '@breakery/domain';
import { toast } from 'sonner';

import { useAgeTimer } from '../hooks/useAgeTimer';
import { useKdsConfig, type KdsConfig } from '../hooks/useKdsConfig';
import { useKdsStartPrepTimer } from '../hooks/useKdsStartPrepTimer';
import { useMarkItemServed } from '../hooks/useMarkItemServed';
import { useKdsBumpOrder } from '../hooks/useKdsBumpOrder';
import type { KdsItemRow } from '../hooks/useKdsOrders';
import { BumpButton } from './BumpButton';
import { PrepTimer } from './PrepTimer';

interface KdsOrderCardProps {
  items: KdsItemRow[];
}

// S75 (task 6) — thresholds now flow from `useKdsConfig()` (business_config
// kds_warning_threshold_minutes / kds_urgent_threshold_minutes), configurable
// from the BO `KDS Configuration` panel. Defaults (5min / 10min) mirror the
// old hardcoded 300s/600s constants.

interface AgeStyle {
  border: string;
  timer: string;
  bandLabel: 'fresh' | 'warning' | 'urgent';
}

function formatAge(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ageStyle(ageMs: number, cfg: KdsConfig): AgeStyle {
  if (ageMs >= cfg.urgentMs) {
    return {
      // motion-safe: the "Late" text badge below is the non-colour signal
      // that stays fully legible under reduced-motion; the pulse is a bonus.
      border: 'border-red motion-safe:animate-pulse',
      timer: 'text-red-as-text font-bold',
      bandLabel: 'urgent',
    };
  }
  if (ageMs >= cfg.warningMs) {
    return {
      border: 'border-amber-warn',
      timer: 'text-amber-warn font-semibold',
      bandLabel: 'warning',
    };
  }
  return {
    border: 'border-border-subtle',
    timer: 'text-text-secondary',
    bandLabel: 'fresh',
  };
}

function ItemCta({ item }: { item: KdsItemRow }) {
  const startTimer = useKdsStartPrepTimer();
  const serve = useMarkItemServed();

  // Session 10: cancelled items have no actionable CTA — only the badge.
  if (item.is_cancelled) {
    return (
      <Badge variant="default" className="bg-red text-red-on-fill border-transparent">
        Cancelled
      </Badge>
    );
  }

  if (item.kitchen_status === 'pending') {
    return (
      <Button
        variant="primary"
        size="md"
        onClick={() => {
          startTimer.mutate(item.id);
        }}
        disabled={startTimer.isPending}
      >
        Start
      </Button>
    );
  }

  if (item.kitchen_status === 'preparing') {
    return <BumpButton orderItemId={item.id} />;
  }

  if (item.kitchen_status === 'ready') {
    return (
      <Button
        variant="secondary"
        size="md"
        // `green` is a bare `var()` token (not the `rgb(var()/<alpha-value>)`
        // form the `cat-*` family uses) — `hover:bg-green/10` is a dead
        // Tailwind class (silently dropped, S25-style token trap). Swap for
        // the `success-soft` semantic alias, which IS a standalone colour
        // token and matches the intent (soft positive-action highlight).
        className="border-green text-green hover:bg-success-soft"
        onClick={() => serve.mutate(item.id)}
        disabled={serve.isPending}
      >
        Mark Served
      </Button>
    );
  }

  return (
    <Badge variant="default" className="bg-green text-green-fg border-transparent">
      Ready
    </Badge>
  );
}

// Session 60 (04 D1.2) — order-scope "All ready" mass bump, wrapping
// `kds_bump_order_v2`. Only rendered when at least one live (non-cancelled)
// item is still pending/preparing. No grouped undo toast — the per-item undo
// (`kds_undo_bump_v2`, 60s via BumpButton/UndoBumpToast) stays available since
// mass-bumped items get `bumped_at` set exactly like a single bump.
function AllReadyButton({ orderId, items }: { orderId: string; items: KdsItemRow[] }) {
  const bumpOrder = useKdsBumpOrder();

  const hasActionableItems = items.some(
    (i) => !i.is_cancelled && (i.kitchen_status === 'pending' || i.kitchen_status === 'preparing'),
  );
  if (!hasActionableItems) return null;

  const handleClick = () => {
    bumpOrder.mutate(
      { orderId },
      {
        onSuccess: ({ bumpedCount }) => {
          toast.success(`${bumpedCount} item${bumpedCount === 1 ? '' : 's'} ready`);
        },
        onError: (err: Error & { code?: string }) => {
          toast.error(err.message || 'Could not bump order');
        },
      },
    );
  };

  return (
    <Button
      variant="gold"
      size="md"
      onClick={handleClick}
      disabled={bumpOrder.isPending}
      aria-label="Bump all items to ready"
    >
      All ready
    </Button>
  );
}

export function KdsOrderCard({ items }: KdsOrderCardProps) {
  const now = useAgeTimer();
  const cfg = useKdsConfig();
  const head = items[0];
  if (!head) return null;

  // The card age is driven by the *oldest* item in the order (FIFO fairness).
  const earliestSent = items.reduce<number>((min, it) => {
    const t = new Date(it.sent_to_kitchen_at).getTime();
    return Number.isFinite(t) && t < min ? t : min;
  }, Number.POSITIVE_INFINITY);
  const ageMs = Number.isFinite(earliestSent) ? now - earliestSent : 0;

  const style = ageStyle(ageMs, cfg);

  return (
    <article
      data-age-band={style.bandLabel}
      // Règle du Filet (critique run 3) : l'élévation du ticket = surface +
      // bordure d'âge, pas d'ombre portée sous le cran `lg`.
      className={`rounded-lg border-2 bg-bg-elevated p-4 flex flex-col gap-3 ${style.border}`}
    >
      {/* flex-wrap (critique run 3, occlusion détectée en page) : sur carte
          étroite, le groupe gauche `min-w-0` se comprimait et ses chips
          `shrink-0` débordaient SOUS le groupe droit — « Takeaway » sous le
          bouton All ready, « PAID » sous « Late ». Le wrap fait descendre le
          groupe droit d'une ligne au lieu de superposer. */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* S43 P2-5a — order_number already carries its `#` prefix; do NOT
              re-prefix here (was rendering `##B-123`). */}
          <span className="font-mono text-2xl font-extrabold tabular-nums text-gold truncate">
            {head.order_number}
          </span>
          {/* Critique run 2 (2026-08-14 P1) — WHERE the plate goes, at the same
              2-3 m glance distance as the timer: `T12 · Dine-in` for table
              service, the service label alone otherwise. */}
          {head.order_type !== '' && (
            <span
              data-testid="kds-service-chip"
              className="shrink-0 text-sm font-bold uppercase tracking-widest text-text-primary border border-border-strong rounded-md px-2 py-0.5"
            >
              {head.order_type === 'dine_in' && head.table_number
                ? `T${head.table_number} · ${orderTypeLabel(head.order_type)}`
                : orderTypeLabel(head.order_type)}
            </span>
          )}
          {/* S43 P2-5b — surfaced so the kitchen knows the ticket is already paid. */}
          {(head.order_status === 'paid' || head.order_status === 'completed') && (
            <Badge variant="default" className="bg-green text-green-fg border-transparent shrink-0">
              PAID
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <AllReadyButton orderId={head.order_id} items={items} />
          {/* Non-colour urgency signal (colour-blind + 2-3 m glance): the age
              band is spelled out once past the warning threshold. */}
          {style.bandLabel !== 'fresh' && (
            <span
              className={`text-sm font-bold uppercase tracking-widest border rounded-md px-2 py-0.5 ${
                style.bandLabel === 'urgent'
                  ? 'border-red text-red-as-text'
                  : 'border-amber-warn text-amber-warn'
              }`}
            >
              {style.bandLabel === 'urgent' ? 'Late' : 'Waiting'}
            </span>
          )}
          <span
            className={`font-mono text-2xl tabular-nums ${style.timer}`}
            aria-label="Order age"
          >
            {formatAge(ageMs)}
          </span>
        </div>
      </header>

      {/* Session 59 (17 D1.1) — order-level note (tablet), e.g. allergy / "no gluten". */}
      {head.order_notes && (
        <div
          className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-amber-warn"
          data-testid="kds-order-note"
        >
          {head.order_notes}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const cancelled = item.is_cancelled;
          return (
            <li
              key={item.id}
              data-cancelled={cancelled ? 'true' : undefined}
              className={`flex items-start justify-between gap-3 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0 ${cancelled ? 'opacity-60' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-mono text-2xl font-bold tabular-nums ${cancelled ? 'text-text-muted line-through' : 'text-text-primary'}`}
                  >
                    {item.quantity}×
                  </span>
                  {/* line-clamp-2 (critique run 3) : à 2-3 m, « Sandwiches
                      Baguette P… » et « …T… » tronqués sur une ligne sont
                      indistinguables ; la tuile POS s'offre déjà deux lignes. */}
                  <span
                    className={`text-2xl font-bold line-clamp-2 ${cancelled ? 'text-text-muted line-through' : 'text-text-primary'}`}
                  >
                    {item.product_name}
                  </span>
                </div>
                {item.modifiers.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {item.modifiers.map((mod, idx) => (
                      <li
                        key={`${item.id}-mod-${idx}`}
                        className={`text-base ${cancelled ? 'text-text-muted line-through' : 'text-text-secondary'}`}
                      >
                        {mod.group_name}: {mod.option_label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {/* ADR-017 (conséquence 5) — modifiers answered on the combo's
                    components, attributed to the component so the kitchen knows
                    which drink is iced / which one takes oat milk. Indented one
                    level under the combo options above. */}
                {item.component_modifiers.length > 0 ? (
                  <ul className="mt-0.5 space-y-0.5" data-testid="kds-component-modifiers">
                    {item.component_modifiers.map((cm, idx) => (
                      <li
                        key={`${item.id}-cmod-${idx}`}
                        className={`pl-3 text-base ${cancelled ? 'text-text-muted line-through' : 'text-text-secondary'}`}
                      >
                        {cm.component_name} — {cm.group_name}: {cm.option_label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {cancelled && item.cancelled_reason && (
                  <div className="mt-1 text-sm uppercase tracking-widest text-red-as-text">
                    Reason: {item.cancelled_reason}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {!cancelled && item.prep_started_at && (
                  <PrepTimer prepStartedAt={item.prep_started_at} />
                )}
                <ItemCta item={item} />
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
