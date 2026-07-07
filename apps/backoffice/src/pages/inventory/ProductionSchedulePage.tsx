// apps/backoffice/src/pages/inventory/ProductionSchedulePage.tsx
//
// Session 15 / Phase 4.B — Production scheduling at
// /backoffice/inventory/production/schedule.
//
// Layout :
//   - Top : week date picker (Monday-anchored).
//   - Main : ProductionCalendarGrid (7 days x 4 slots).
//   - Sidebar : suggestions panel for the focused date — pulls from
//     suggest_production_schedule_v1 and lets the user click "+" to add a row.
//
// Route is gated by `inventory.production.schedule` at routes/index.tsx, and
// the page also defensively checks the permission to render the action UI.

import { useMemo, useState, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { ProductionCalendarGrid } from '@/features/inventory-production/components/ProductionCalendarGrid.js';
import {
  useDeleteSchedule,
  useProductionSchedules,
  useScheduleSuggestions,
  useUpsertSchedule,
  startOfWeekMonday,
  toIsoDate,
  addDays,
  type ScheduleRow,
  type ScheduleSlot,
  type ScheduleStatus,
} from '@/features/inventory-production/hooks/useProductionSchedule.js';

export default function ProductionSchedulePage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('inventory.production.schedule');

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const [focusedDate, setFocusedDate] = useState<string>(() => toIsoDate(startOfWeekMonday(new Date())));
  const [focusedSlot, setFocusedSlot] = useState<ScheduleSlot>('5am');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedulesQ   = useProductionSchedules(weekStart);
  const suggestionsQ = useScheduleSuggestions(new Date(`${focusedDate}T00:00:00Z`));
  const upsertMut    = useUpsertSchedule();
  const deleteMut    = useDeleteSchedule();

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  function handleWeekChange(iso: string): void {
    const next = new Date(`${iso}T00:00:00Z`);
    if (Number.isFinite(next.getTime())) {
      const monday = startOfWeekMonday(next);
      setWeekStart(monday);
      setFocusedDate(toIsoDate(monday));
    }
  }

  function handleCellClick(date: string, slot: ScheduleSlot): void {
    setFocusedDate(date);
    setFocusedSlot(slot);
    setEditingId(null);
  }

  function handleScheduleClick(s: ScheduleRow): void {
    setFocusedDate(s.scheduledDate);
    setFocusedSlot(s.slot);
    setEditingId(s.id);
  }

  async function addFromSuggestion(productId: string, qty: number): Promise<void> {
    if (!canEdit) return;
    setError(null);
    try {
      await upsertMut.mutateAsync({
        scheduledDate: focusedDate,
        slot:          focusedSlot,
        recipeId:      productId,
        plannedQty:    qty > 0 ? qty : 1,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add schedule.');
    }
  }

  async function changeStatus(s: ScheduleRow, next: ScheduleStatus): Promise<void> {
    setError(null);
    try {
      await upsertMut.mutateAsync({
        id:            s.id,
        scheduledDate: s.scheduledDate,
        slot:          s.slot,
        recipeId:      s.recipeId ?? '',
        plannedQty:    s.plannedQty,
        status:        next,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status.');
    }
  }

  async function softCancel(s: ScheduleRow): Promise<void> {
    setError(null);
    try {
      await deleteMut.mutateAsync({ id: s.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel.');
    }
  }

  if (!canEdit) {
    return (
      <div className="text-text-secondary">
        You do not have permission to plan production schedules.
      </div>
    );
  }

  const schedules = schedulesQ.data ?? [];
  const editing   = editingId !== null ? schedules.find((s) => s.id === editingId) : undefined;
  const focused   = schedules.filter((s) => s.scheduledDate === focusedDate && s.slot === focusedSlot);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Production Schedule</h1>
          <p className="mt-1 text-sm text-text-secondary">
            7-day grid with 4 fournée slots ({toIsoDate(weekStart)} → {toIsoDate(weekEnd)}).
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="uppercase tracking-widest text-text-secondary">Week of</span>
          <input
            type="date"
            value={toIsoDate(weekStart)}
            onChange={(e) => handleWeekChange(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
            aria-label="Week start date"
          />
        </label>
      </div>

      {error !== null && (
        <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <section data-testid="schedule-main" className="space-y-2">
          {schedulesQ.isLoading ? (
            <div className="text-text-secondary text-sm">Loading…</div>
          ) : (
            <ProductionCalendarGrid
              weekStart={weekStart}
              schedules={schedules}
              onCellClick={handleCellClick}
              onScheduleClick={handleScheduleClick}
            />
          )}
        </section>

        <aside data-testid="suggestions-panel" className="space-y-3 rounded-md border border-border-subtle bg-bg-card p-3 text-xs">
          <header>
            <h2 className="font-serif text-lg">Suggestions</h2>
            <p className="mt-0.5 text-[11px] text-text-secondary">
              Focused : <span className="font-mono">{focusedDate} {focusedSlot}</span>
            </p>
          </header>

          {suggestionsQ.isLoading && <div className="text-text-secondary">Loading…</div>}
          {suggestionsQ.error !== null && suggestionsQ.error !== undefined && (
            <div className="text-red">Could not load suggestions.</div>
          )}

          {suggestionsQ.data !== undefined && (
            <ul className="space-y-2" data-testid="suggestions-list">
              {suggestionsQ.data.suggestions.length === 0 && (
                <li className="text-text-secondary">No suggestions for this date.</li>
              )}
              {suggestionsQ.data.suggestions.slice(0, 12).map((s) => (
                <li
                  key={s.product_id}
                  className="flex items-center justify-between gap-2 rounded border border-border-subtle bg-bg-input p-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.product_name}</div>
                    <div className="text-[10px] text-text-secondary">
                      {s.has_sufficient_history
                        ? `avg ${s.avg_daily_sales}/day · ${s.margin_pct}% margin`
                        : `< 7 days history`}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => { void addFromSuggestion(s.product_id, s.suggested_qty); }}
                    aria-label={`Add ${s.product_name}`}
                  >
                    +{s.suggested_qty > 0 ? ` ${s.suggested_qty}` : ''}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* Focused cell editor — inline pane under the grid. */}
      {focused.length > 0 && (
        <section
          data-testid="cell-editor"
          className="rounded-md border border-border-subtle bg-bg-card p-3 text-xs"
        >
          <h3 className="mb-2 font-serif text-base">
            {focusedDate} · {focusedSlot}
          </h3>
          <ul className="space-y-1">
            {focused.map((s) => (
              <li
                key={s.id}
                className={`flex items-center justify-between gap-2 rounded border border-border-subtle bg-bg-input p-2 ${editing?.id === s.id ? 'ring-1 ring-gold' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{s.recipeName ?? '(no recipe)'}</div>
                  <div className="text-[10px] text-text-secondary">qty {s.plannedQty} · status {s.status}</div>
                </div>
                <div className="flex items-center gap-1">
                  {s.status === 'scheduled' && (
                    <Button type="button" variant="ghost" onClick={() => { void changeStatus(s, 'started'); }}>Start</Button>
                  )}
                  {s.status === 'started' && (
                    <Button type="button" variant="ghost" onClick={() => { void changeStatus(s, 'completed'); }}>Complete</Button>
                  )}
                  {(s.status === 'scheduled' || s.status === 'started') && (
                    <Button type="button" variant="ghost" onClick={() => { void changeStatus(s, 'skipped'); }}>Skip</Button>
                  )}
                  {(s.status === 'scheduled' || s.status === 'started') && (
                    <Button type="button" variant="ghost" onClick={() => { void softCancel(s); }}>Cancel</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
