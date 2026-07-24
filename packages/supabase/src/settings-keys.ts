// S73 Phase 3 — single typed dictionary of business_config setting keys and
// symbolic categories (server truth: set_setting_v9 / get_settings_by_category_v7,
// migrations 20260711000159 + 20260716000168 + 20260718000195 + 20260721000197
// + 20260724000217 + 20260724000220). Add a key here ONLY together with its RPC branch.
export const SETTINGS_CATEGORIES = [
  'business', 'localization', 'tax', 'pos', 'pos_presets',
  'inventory', 'payments', 'customer_display', 'printing', 'kds', 'network',
  'security',
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export const SETTING_KEYS = {
  // 2026-07-16 (Settings §6.A): identity on documents (npwp/phone/logo_url)
  // + internal alert recipient (alert_email), migration 20260716000168.
  // ADR-006 déc. 9 : business_hours — créneau {open, close} HH:MM par jour de
  // semaine (mon..sun), null = fermé, clé absente = non configuré.
  business:         ['name', 'fiscal_address', 'npwp', 'phone', 'logo_url', 'alert_email',
                     'business_hours'],
  localization:     ['currency', 'timezone'],
  tax:              ['tax_rate', 'tax_inclusive'],
  pos:              ['shift_variance_threshold_pct', 'shift_variance_threshold_abs',
                     'shift_variance_pin_threshold_pct', 'shift_variance_pin_threshold_abs',
                     'shift_denomination_count_enabled'],
  pos_presets:      ['pos_quick_payment_amounts', 'pos_opening_cash_presets', 'pos_discount_presets'],
  inventory:        ['allow_negative_stock'],
  // Lot C (ADR-006 déc. 9) : payment_method_fees — % de frais informatifs par
  // méthode ({"qris": 0.7, ...}), migration 20260723000213. Aucun JE automatique.
  payments:         ['enabled_payment_methods', 'payment_method_fees'],
  customer_display: ['display_footer_message', 'display_slogan'],
  // Chantier KOT copies (2026-07-18): paper kitchen-ticket copies per station
  // at fire time; 0 = no paper for that station (KDS screen still receives).
  printing:         ['pos_auto_print_receipt', 'pos_auto_open_drawer',
                     'kot_copies_barista', 'kot_copies_kitchen', 'kot_copies_display'],
  // S75 (Task 5): KDS ticket-age color-band thresholds + auto-archive delay.
  kds:              ['kds_warning_threshold_minutes', 'kds_urgent_threshold_minutes',
                     'kds_auto_archive_minutes'],
  // Spec 006x lot 4 (hub LAN) : cash hors-ligne différé — activation explicite
  // (défaut false) + fenêtre offline maximale en heures (défaut 4, arbitrage A5).
  network:          ['offline_cash_enabled', 'offline_max_hours'],
  // ADR-006 déc. 9 : PIN policy — lockout login configurable (lu par l'EF
  // auth-verify-pin, fallback 5/15). Migration 20260724000220.
  security:         ['pin_max_failed', 'pin_lockout_minutes'],
} as const satisfies Record<SettingsCategory, readonly string[]>;
export type SettingKey = (typeof SETTING_KEYS)[SettingsCategory][number];
