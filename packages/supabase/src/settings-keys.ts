// S73 Phase 3 — single typed dictionary of business_config setting keys and
// symbolic categories (server truth: set_setting_v2 / get_settings_by_category_v2,
// migrations 20260711000159 + 20260716000168). Add a key here ONLY together
// with its RPC branch.
export const SETTINGS_CATEGORIES = [
  'business', 'localization', 'tax', 'pos', 'pos_presets',
  'inventory', 'payments', 'customer_display', 'printing', 'kds',
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export const SETTING_KEYS = {
  // 2026-07-16 (Settings §6.A): identity on documents (npwp/phone/logo_url)
  // + internal alert recipient (alert_email), migration 20260716000168.
  business:         ['name', 'fiscal_address', 'npwp', 'phone', 'logo_url', 'alert_email'],
  localization:     ['currency', 'timezone'],
  tax:              ['tax_rate', 'tax_inclusive'],
  pos:              ['shift_variance_threshold_pct', 'shift_variance_threshold_abs',
                     'shift_variance_pin_threshold_pct', 'shift_variance_pin_threshold_abs',
                     'shift_denomination_count_enabled'],
  pos_presets:      ['pos_quick_payment_amounts', 'pos_opening_cash_presets', 'pos_discount_presets'],
  inventory:        ['allow_negative_stock'],
  payments:         ['enabled_payment_methods'],
  customer_display: ['display_footer_message', 'display_slogan'],
  printing:         ['pos_auto_print_receipt', 'pos_auto_open_drawer'],
  // S75 (Task 5): KDS ticket-age color-band thresholds + auto-archive delay.
  kds:              ['kds_warning_threshold_minutes', 'kds_urgent_threshold_minutes',
                     'kds_auto_archive_minutes'],
} as const satisfies Record<SettingsCategory, readonly string[]>;
export type SettingKey = (typeof SETTING_KEYS)[SettingsCategory][number];
