// S73 Phase 3 — single typed dictionary of business_config setting keys and
// symbolic categories (server truth: set_setting_v13 / get_settings_by_category_v10,
// migrations 20260711000159 + 20260716000168 + 20260718000195 + 20260721000197
// + 20260724000217 + 20260724000220 + 20260802000003). Add a key here ONLY
// together with its RPC branch.
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
  // ADR-019 (D3) : `timezone` n'est plus une clé réglable — le fuseau métier est
  // une constante de déploiement portée par le paramètre de session PostgreSQL.
  // La colonne business_config.timezone reste lisible (D2), elle n'est plus
  // écrivable : set_setting_v13 refuse la clé.
  localization:     ['currency'],
  tax:              ['tax_rate', 'tax_inclusive'],
  pos:              ['shift_variance_threshold_pct', 'shift_variance_threshold_abs',
                     'shift_variance_pin_threshold_pct', 'shift_variance_pin_threshold_abs',
                     'shift_denomination_count_enabled'],
  pos_presets:      ['pos_quick_payment_amounts', 'pos_opening_cash_presets', 'pos_discount_presets'],
  inventory:        ['allow_negative_stock'],
  // Lot C (ADR-006 déc. 9) : payment_method_fees — % de frais informatifs par
  // méthode ({"qris": 0.7, ...}), migration 20260723000213. Aucun JE automatique.
  // ADR-013 Lot 4 (D7) : store_credit_expiry_months — durée de vie des avoirs
  // client en mois, 0 = jamais (défaut). Migration 20260726000234.
  payments:         ['enabled_payment_methods', 'payment_method_fees',
                     'store_credit_expiry_months'],
  // ADR-023 : la vitrine de l'écran client au repos — display_showcase_product_ids
  // est une liste ORDONNÉE d'ids produit (12 au plus, jamais de prix : il est
  // résolu depuis le catalogue à l'affichage) ; display_show_ready_orders rend
  // la file de retrait à l'écran, éteint par défaut. Migration 20260811000002.
  customer_display: ['display_footer_message', 'display_slogan',
                     'display_showcase_product_ids', 'display_show_ready_orders'],
  // Chantier KOT copies (2026-07-18): paper kitchen-ticket copies per station
  // at fire time; 0 = no paper for that station (KDS screen still receives).
  printing:         ['pos_auto_print_receipt', 'pos_auto_open_drawer',
                     'kot_copies_barista', 'kot_copies_kitchen', 'kot_copies_display'],
  // S75 (Task 5): KDS ticket-age color-band thresholds + auto-archive delay.
  kds:              ['kds_warning_threshold_minutes', 'kds_urgent_threshold_minutes',
                     'kds_auto_archive_minutes'],
  // ADR-015 (hub LAN) : encaissement hors-ligne, toutes méthodes sauf l'avoir —
  // activation explicite (défaut false). La fenêtre offline_max_hours est
  // supprimée (migration _252).
  network:          ['offline_payments_enabled'],
  // ADR-006 déc. 9 : PIN policy — lockout login configurable (lu par l'EF
  // auth-verify-pin, fallback 5/15). Migration 20260724000220.
  security:         ['pin_max_failed', 'pin_lockout_minutes'],
} as const satisfies Record<SettingsCategory, readonly string[]>;
export type SettingKey = (typeof SETTING_KEYS)[SettingsCategory][number];
