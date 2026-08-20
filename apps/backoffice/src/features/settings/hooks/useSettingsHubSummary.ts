// apps/backoffice/src/features/settings/hooks/useSettingsHubSummary.ts
//
// Lot 5 chantier 1 (brief /impeccable shape validé 2026-08-13) — le hub
// Réglages instancie l'archétype « chaque tuile porte sa valeur courante »
// (DESIGN.md § archétype 5). Un aller-retour : get_settings_hub_summary_v1.
// Les sections gatées par permission sont ABSENTES du payload pour les
// profils qui ne les détiennent pas — la tuile montre alors un tiret.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface HubSummary {
  company?: { name: string; currency: string; tax_inclusive: boolean; tax_rate: number };
  business_hours?: Record<string, { open: string; close: string } | null>;
  holidays?: { upcoming_count: number; next_date: string | null; next_name: string | null };
  pos_config?: { quick_amounts: number; opening_presets: number; discount_presets: number };
  payment_methods?: { enabled: number };
  printing?: { auto_print_receipt: boolean; auto_open_drawer: boolean };
  kds?: { warning_minutes: number; urgent_minutes: number; auto_archive_minutes: number };
  customer_display?: { slogan_set: boolean; showcase_count: number; show_ready_orders: boolean };
  inventory?: { allow_negative_stock: boolean };
  notifications?: { active: number; total: number };
  email_templates?: { active: number; total: number };
  receipt_templates?: { total: number; default_name: string | null };
  permissions?: { roles: number };
  floor_plan?: { active_tables: number };
  security?: { pin_max_failed: number; pin_lockout_minutes: number };
  accounting?: { open_period_start: string | null };
  expense_thresholds?: { tiers: number };
  lan_devices?: { active: number; total: number };
}

export const SETTINGS_HUB_SUMMARY_KEY = ['settings', 'hub-summary'] as const;

export function useSettingsHubSummary() {
  return useQuery<HubSummary>({
    queryKey: SETTINGS_HUB_SUMMARY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_settings_hub_summary_v1');
      if (error) throw error;
      return (data ?? {}) as HubSummary;
    },
    staleTime: 30_000,
  });
}

// ── Formatteurs de valeur de tuile ──────────────────────────────────────────
// Clé = la route de la tuile. `undefined` = la tuile n'a pas de valeur
// (le blurb reste) ; `null` = valeur applicable mais indisponible (section
// gatée absente, donnée vide) → tiret côté écran.

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABEL: Record<(typeof DAY_ORDER)[number], string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

/** « Mon–Sat 07:00–21:00 · Sun closed » — groupes de jours consécutifs identiques. */
export function compressBusinessHours(
  bh: Record<string, { open: string; close: string } | null> | undefined,
): string | null {
  if (bh === undefined) return null;
  const spans: { from: number; to: number; text: string }[] = [];
  for (let i = 0; i < DAY_ORDER.length; i++) {
    const d = bh[DAY_ORDER[i]!];
    const text = d != null ? `${d.open}–${d.close}` : 'closed';
    const last = spans[spans.length - 1];
    if (last?.text === text && last.to === i - 1) last.to = i;
    else spans.push({ from: i, to: i, text });
  }
  if (spans.every((s) => s.text === 'closed')) return null; // jamais configuré
  return spans
    .map((s) => {
      const days = s.from === s.to
        ? DAY_LABEL[DAY_ORDER[s.from]!]
        : `${DAY_LABEL[DAY_ORDER[s.from]!]}–${DAY_LABEL[DAY_ORDER[s.to]!]}`;
      return `${days} ${s.text}`;
    })
    .join(' · ');
}

/**
 * `business_config.tax_rate` est stocké en FRACTION (`0.1000` = 10 %), comme
 * tous les champs `percent` de la fiche Réglages. `SettingsGeneralPage.tsx`
 * affirmait être « the ONLY place the conversion happens on read » ; ce hub
 * lisait la même colonne et l'imprimait brute avec un `%`. La tuile annonçait
 * donc **« tax 0.1% »** à une boutique dont le PB1 est à **10 %** — un taux de
 * taxe faux au premier écran des Réglages (relevé du 2026-08-20).
 *
 * Deux précautions, et aucune n'est cosmétique :
 *  · **l'arrondi est obligatoire** — pas pour le taux d'aujourd'hui (`0.1 * 100`
 *    tombe juste sur `10`), mais pour la plupart des autres : `0.07 * 100` vaut
 *    `7.000000000000001` et `0.29 * 100` vaut `28.999999999999996`. Sans lui, la
 *    tuile rendrait ces nombres-là au premier changement de taux (vérifié dans
 *    node le 2026-08-20) ;
 *  · **le repli au-dessus de 1** reprend l'idiome déjà posé par
 *    `ProductionForm.tsx` : une valeur > 1 est déjà encodée en pourcent, on ne
 *    la multiplie pas une seconde fois.
 */
export function percentFromFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const asPercent = value <= 1 ? value * 100 : value;
  return Math.round(asPercent * 1000) / 1000;
}

type Formatter = (s: HubSummary) => string | null;

const FORMATTERS: Record<string, Formatter> = {
  '/backoffice/settings/general': (s) =>
    s.company
      ? `${s.company.name} · ${s.company.currency} · tax ${percentFromFraction(s.company.tax_rate)}% ${s.company.tax_inclusive ? 'incl.' : 'excl.'}`
      : null,
  '/backoffice/settings/business-hours': (s) => compressBusinessHours(s.business_hours),
  '/backoffice/settings/holidays': (s) =>
    s.holidays
      ? s.holidays.upcoming_count > 0 && s.holidays.next_name !== null
        ? `${s.holidays.upcoming_count} upcoming · next ${s.holidays.next_name} (${s.holidays.next_date ?? ''})`
        : 'None upcoming'
      : null,
  '/backoffice/settings/pos': (s) =>
    s.pos_config
      ? `${s.pos_config.quick_amounts} quick amounts · ${s.pos_config.discount_presets} discount presets`
      : null,
  '/backoffice/settings/payment-methods': (s) =>
    s.payment_methods ? `${s.payment_methods.enabled} methods enabled` : null,
  '/backoffice/settings/printing': (s) =>
    s.printing
      ? `Auto-print ${s.printing.auto_print_receipt ? 'on' : 'off'} · drawer ${s.printing.auto_open_drawer ? 'on' : 'off'}`
      : null,
  '/backoffice/settings/floor-plan': (s) =>
    s.floor_plan ? `${s.floor_plan.active_tables} active tables` : null,
  '/backoffice/settings/kds': (s) =>
    s.kds
      ? `Warn ${s.kds.warning_minutes} min · urgent ${s.kds.urgent_minutes} min · archive ${s.kds.auto_archive_minutes} min`
      : null,
  '/backoffice/settings/customer-display': (s) =>
    s.customer_display
      ? `${s.customer_display.slogan_set ? 'Slogan set' : 'No slogan'} · ${s.customer_display.showcase_count} showcase items`
      : null,
  '/backoffice/settings/inventory': (s) =>
    s.inventory ? `Negative stock ${s.inventory.allow_negative_stock ? 'allowed' : 'blocked'}` : null,
  '/backoffice/settings/notifications': (s) =>
    s.notifications ? `${s.notifications.active}/${s.notifications.total} active` : null,
  '/backoffice/settings/templates/email': (s) =>
    s.email_templates ? `${s.email_templates.active}/${s.email_templates.total} active` : null,
  '/backoffice/settings/templates/receipt': (s) =>
    s.receipt_templates
      ? `${s.receipt_templates.total} templates${s.receipt_templates.default_name !== null ? ` · default ${s.receipt_templates.default_name}` : ''}`
      : null,
  '/backoffice/settings/permissions': (s) =>
    s.permissions ? `${s.permissions.roles} roles` : null,
  '/backoffice/settings/security': (s) =>
    s.security
      ? `${s.security.pin_max_failed} PIN attempts · lockout ${s.security.pin_lockout_minutes} min`
      : null,
  '/backoffice/settings/accounting': (s) =>
    s.accounting
      ? s.accounting.open_period_start !== null
        ? `Open period since ${s.accounting.open_period_start}`
        : 'No open period'
      : null,
  '/backoffice/settings/expense-thresholds': (s) =>
    s.expense_thresholds ? `${s.expense_thresholds.tiers} approval tiers` : null,
  '/backoffice/lan-devices': (s) =>
    s.lan_devices ? `${s.lan_devices.active}/${s.lan_devices.total} active` : null,
};

/**
 * Valeur courante d'une tuile. `undefined` = pas de concept de valeur pour
 * cette tuile (garder le blurb) ; `null` = tiret ; sinon la ligne à afficher.
 */
export function summaryLineFor(
  to: string | undefined,
  summary: HubSummary | undefined,
): string | null | undefined {
  if (to === undefined) return undefined;
  const fmt = FORMATTERS[to];
  if (fmt === undefined) return undefined;
  if (summary === undefined) return null;
  return fmt(summary);
}
