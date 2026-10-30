import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isMain, ROOT } from '../agents/lib.mjs';
import { checkRelease } from './preflight.mjs';

// Exception bornée à ce candidat ; aucun SHA ni chemin libre en entrée.
export const BANK_RELEASE = Object.freeze({
  baseline: '6af3822bfcfb0e2efa6de445dc38bdfc0c9838ab',
  candidate: '5e4ab2b2aa5efad4e26dce4acc351c5774d65def',
  production: 'yjhhhmjgsmyzyymvixot',
  rehearsal: 'getctmbpjnrrjzncaqze',
  migration: 'supabase/migrations/20261030000010_bank_historical_clearing.sql',
});
// Sources SQL corrigées, séparées du candidat applicatif bancaire inchangé.
export const BANK_SQL_TEST_SHA = 'eae0d2dfa3bb31e352d203c5598e3cf5f9cb63f3';
export const BANK_SQL_TEST_COUNT = 314;
export const BANK_SQL_FIXTURE_FILES = Object.freeze([
  "supabase/tests/adr008_d2_d3_d9.test.sql",
  "supabase/tests/adr008_d5_d6.test.sql",
  "supabase/tests/adr008_d7_d8.test.sql",
  "supabase/tests/adr013_lot3_totals_parity.test.sql",
  "supabase/tests/adr016_descente_semi_finis.test.sql",
  "supabase/tests/adr023_vitrine_colonnes.test.sql",
  "supabase/tests/adr023_vitrine_reglages.test.sql",
  "supabase/tests/ar_aging.test.sql",
  "supabase/tests/audit_medium_db_fixes.test.sql",
  "supabase/tests/b2b_allocation_invariant.test.sql",
  "supabase/tests/b2b_balance_adjust_je_pin.test.sql",
  "supabase/tests/b2b_credit.test.sql",
  "supabase/tests/b2b_display_aware_stock.test.sql",
  "supabase/tests/b2b_foundation.test.sql",
  "supabase/tests/b2b_invoice.test.sql",
  "supabase/tests/b2b_invoice_backfill.test.sql",
  "supabase/tests/b2b_invoice_creation.test.sql",
  "supabase/tests/b2b_invoice_read.test.sql",
  "supabase/tests/b2b_negotiated_price.test.sql",
  "supabase/tests/b2b_order_flag_aware_stock.test.sql",
  "supabase/tests/b2b_pickup_tracking.test.sql",
  "supabase/tests/b2b_settlement.test.sql",
  "supabase/tests/baker_percentage.test.sql",
  "supabase/tests/bakery_reports.test.sql",
  "supabase/tests/batch_production.test.sql",
  "supabase/tests/batch_production_flag_negative.test.sql",
  "supabase/tests/cash_wallets.test.sql",
  "supabase/tests/cashier_variance.test.sql",
  "supabase/tests/catalog_import.test.sql",
  "supabase/tests/close_fiscal_year_v2.test.sql",
  "supabase/tests/close_shift_note_enforced.test.sql",
  "supabase/tests/close_shift_pin_gate.test.sql",
  "supabase/tests/close_shift_three_way.test.sql",
  "supabase/tests/combo_component_flag_aware.test.sql",
  "supabase/tests/combo_crud.test.sql",
  "supabase/tests/combo_crud_delete.test.sql",
  "supabase/tests/combo_crud_write.test.sql",
  "supabase/tests/combo_fire_pay.test.sql",
  "supabase/tests/combo_reversal.test.sql",
  "supabase/tests/combo_sale.test.sql",
  "supabase/tests/combo_sales.test.sql",
  "supabase/tests/combo_server_pricing.test.sql",
  "supabase/tests/customer_category_crud.test.sql",
  "supabase/tests/customer_product_prices_rls.test.sql",
  "supabase/tests/customers_categorie_obligatoire.test.sql",
  "supabase/tests/discounts_loyalty.test.sql",
  "supabase/tests/expense_governance.test.sql",
  "supabase/tests/expense_terminology.test.sql",
  "supabase/tests/f6_sub_recipes.test.sql",
  "supabase/tests/floor_plan_crud.test.sql",
  "supabase/tests/get_settings_hub_summary_v1.test.sql",
  "supabase/tests/gross_margin_by_product.test.sql",
  "supabase/tests/helpers/b2b_foundation_cases_01.sql",
  "supabase/tests/helpers/b2b_foundation_cases_02.sql",
  "supabase/tests/helpers/catalog.sql",
  "supabase/tests/helpers/catalog_import_cases_01.sql",
  "supabase/tests/helpers/catalog_import_cases_02.sql",
  "supabase/tests/helpers/combo_catalog.sql",
  "supabase/tests/helpers/customer_category.sql",
  "supabase/tests/helpers/inventory_cases_01.sql",
  "supabase/tests/helpers/inventory_cases_02.sql",
  "supabase/tests/helpers/inventory_cases_03.sql",
  "supabase/tests/helpers/legacy_permissions.sql",
  "supabase/tests/helpers/legacy_users.sql",
  "supabase/tests/helpers/product_variants_cases_01.sql",
  "supabase/tests/helpers/product_variants_cases_02.sql",
  "supabase/tests/helpers/s40_reports_cases_01.sql",
  "supabase/tests/helpers/s40_reports_cases_02.sql",
  "supabase/tests/helpers/s40_reports_cases_03.sql",
  "supabase/tests/helpers/sales.sql",
  "supabase/tests/historical_customer_advances_guards.test.sql",
  "supabase/tests/historical_customer_advances_money.test.sql",
  "supabase/tests/historical_import_financial_choices.test.sql",
  "supabase/tests/historical_import_normal_money.test.sql",
  "supabase/tests/historical_import_supplier_prepayments.test.sql",
  "supabase/tests/hub_lan_offline_settings.test.sql",
  "supabase/tests/idempotency_hardening.test.sql",
  "supabase/tests/inventory.test.sql",
  "supabase/tests/inventory_opname.test.sql",
  "supabase/tests/inventory_production.test.sql",
  "supabase/tests/lan_devices_rls.test.sql",
  "supabase/tests/loyalty_to_store_credit_je.test.sql",
  "supabase/tests/loyalty_transactions_append_only.test.sql",
  "supabase/tests/margin_alerts.test.sql",
  "supabase/tests/marketing.test.sql",
  "supabase/tests/modifier_ingredient_deduction.test.sql",
  "supabase/tests/orders_list_v4_envelope.test.sql",
  "supabase/tests/pay_existing_cancelled_lines.test.sql",
  "supabase/tests/pay_existing_flag_aware.test.sql",
  "supabase/tests/pay_existing_recipe_consumption.test.sql",
  "supabase/tests/pb1_dedup_void_refund.test.sql",
  "supabase/tests/picker_polish.test.sql",
  "supabase/tests/po_create.test.sql",
  "supabase/tests/po_je_double_entry.test.sql",
  "supabase/tests/po_payments.test.sql",
  "supabase/tests/po_receive_conversion.test.sql",
  "supabase/tests/po_update.test.sql",
  "supabase/tests/pos_activity.test.sql",
  "supabase/tests/pos_events.test.sql",
  "supabase/tests/pos_events_reader.test.sql",
  "supabase/tests/pos_events_unified.test.sql",
  "supabase/tests/pos_order_type_category_mix.test.sql",
  "supabase/tests/pos_payment_breakdown.test.sql",
  "supabase/tests/pos_sales_overview.test.sql",
  "supabase/tests/pos_sessions_report.test.sql",
  "supabase/tests/pos_top_products.test.sql",
  "supabase/tests/pos_voids_refunds.test.sql",
  "supabase/tests/product_category_crud.test.sql",
  "supabase/tests/product_category_prices.test.sql",
  "supabase/tests/product_performance.test.sql",
  "supabase/tests/product_variants.test.sql",
  "supabase/tests/production_flag_negative.test.sql",
  "supabase/tests/production_schedule.test.sql",
  "supabase/tests/products_cost_price_guard.test.sql",
  "supabase/tests/purchase_price_trends.test.sql",
  "supabase/tests/purchasing_po.test.sql",
  "supabase/tests/realtime_publication_orders.test.sql",
  "supabase/tests/realtime_publication_settings.test.sql",
  "supabase/tests/recipe_bom_full_v2.test.sql",
  "supabase/tests/recipe_cost_history_v1.test.sql",
  "supabase/tests/refund_void_cross_shift_v11.test.sql",
  "supabase/tests/refunds_report.test.sql",
  "supabase/tests/reopen_held_order_v1_behavior.test.sql",
  "supabase/tests/reports.test.sql",
  "supabase/tests/retail_tab_credit_gate.test.sql",
  "supabase/tests/reversal_recipe_restoration.test.sql",
  "supabase/tests/role_lifecycle_rpcs.test.sql",
  "supabase/tests/s40_reports.test.sql",
  "supabase/tests/sale_flag_aware_deduction.test.sql",
  "supabase/tests/sales_by_customer.test.sql",
  "supabase/tests/sales_by_origin.test.sql",
  "supabase/tests/sales_by_product.test.sql",
  "supabase/tests/sales_by_table.test.sql",
  "supabase/tests/sections_rpc.test.sql",
  "supabase/tests/security.test.sql",
  "supabase/tests/set_product_is_test.test.sql",
  "supabase/tests/set_role_permission_v1.test.sql",
  "supabase/tests/settings_kds.test.sql",
  "supabase/tests/settings_kot_copies.test.sql",
  "supabase/tests/stock_audit_opname_units.test.sql",
  "supabase/tests/stock_movement_ledger.test.sql",
  "supabase/tests/stock_mutation_security.test.sql",
  "supabase/tests/stock_position.test.sql",
  "supabase/tests/store_credit_expiry_reprise_produit.test.sql",
  "supabase/tests/store_credit_reconciliation.test.sql",
  "supabase/tests/store_credit_spend_gate.test.sql",
  "supabase/tests/supplier_payments.test.sql",
  "supabase/tests/tablet_append_to_order.test.sql",
  "supabase/tests/trial_balance_v3_cumulative.test.sql",
  "supabase/tests/update_account_active_v1.test.sql",
  "supabase/tests/update_accounting_mapping_v2.test.sql",
  "supabase/tests/update_product_v2.test.sql",
  "supabase/tests/update_role_session_timeout_v2.test.sql",
  "supabase/tests/user_permission_override_rpcs.test.sql",
  "supabase/tests/void_zreport_v2_manager_pin.test.sql",
  "supabase/tests/zreports.test.sql",
].sort());

export const BANK_FILES = Object.freeze([
  'apps/backoffice/src/features/accounting/bank-reconciliation/__tests__/bank-api.test.ts',
  'apps/backoffice/src/features/accounting/bank-reconciliation/api.ts',
  'packages/supabase/src/types.generated.ts',
  BANK_RELEASE.migration,
  'supabase/tests/bank_reconciliation.test.sql',
  'supabase/tests/bank_reconciliation_historical.test.sql',
  'supabase/tests/bank_reconciliation_import.test.sql',
  'supabase/tests/bank_reconciliation_net_fee.test.sql',
].sort());

export function inspectBankTestSource({ git }) {
  git(['merge-base', '--is-ancestor', BANK_RELEASE.candidate, BANK_SQL_TEST_SHA]);
  const changes = git(['diff', '--no-renames', '--name-status', BANK_RELEASE.candidate, BANK_SQL_TEST_SHA])
    .toString().trim().split('\n').map((line) => line.split('\t'));
  if (changes.some(([status, path, extra]) => !['A', 'M'].includes(status) || !path || extra) ||
      JSON.stringify(changes.map(([, path]) => path).sort()) !== JSON.stringify(BANK_SQL_FIXTURE_FILES)) {
    throw new Error('Le diff des sources SQL doit contenir exactement les fixtures autorisées.');
  }
  const entries = git(['ls-tree', '-r', BANK_SQL_TEST_SHA, '--', 'supabase/tests']).toString().trim().split('\n')
    .map((line) => line.match(/^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/));
  const regularFiles = new Map(entries.filter(Boolean).map((entry) => [entry[4], entry[1] === '100644' && entry[2] === 'blob']));
  if (BANK_SQL_FIXTURE_FILES.some((path) => !regularFiles.get(path)) ||
      entries.filter((entry) => entry && /^supabase\/tests\/[^/]+\.test\.sql$/.test(entry[4])).length !== BANK_SQL_TEST_COUNT) {
    throw new Error('Arbre SQL incomplet ou fichier de fixture irrégulier.');
  }
  return { sourceSha: BANK_SQL_TEST_SHA, applicationSourceSha: BANK_RELEASE.candidate,
    suiteFiles: BANK_SQL_TEST_COUNT, files: BANK_SQL_FIXTURE_FILES.map((path) => ({ path,
      sha256: createHash('sha256').update(git(['show', `${BANK_SQL_TEST_SHA}:${path}`])).digest('hex'),
    })) };
}

export function inspectBankSource({ controllerSha, git }) {
  if (!/^[a-f0-9]{40}$/.test(controllerSha ?? '')) throw new Error('SHA contrôleur requis.');
  git(['merge-base', '--is-ancestor', BANK_RELEASE.baseline, BANK_RELEASE.candidate]);
  git(['merge-base', '--is-ancestor', BANK_RELEASE.baseline, controllerSha]);
  const changes = git(['diff', '--no-renames', '--name-status', BANK_RELEASE.baseline, BANK_RELEASE.candidate])
    .toString().trim().split('\n').map((line) => line.split('\t'));
  if (changes.some(([status, path, extra]) => !['A', 'M'].includes(status) || !path || extra) ||
      JSON.stringify(changes.map(([, path]) => path).sort()) !== JSON.stringify(BANK_FILES)) {
    throw new Error('Le diff doit contenir exactement les huit fichiers bancaires autorisés.');
  }
  // Une fusion squash ne conserve pas l'ascendance du candidat. Vérifier les
  // sources et tests exacts ; seuls les types générés contiennent aussi la caisse.
  for (const path of BANK_FILES.filter((path) => !path.endsWith('/types.generated.ts'))) {
    if (!git(['show', `${controllerSha}:${path}`]).equals(git(['show', `${BANK_RELEASE.candidate}:${path}`]))) {
      throw new Error(`Contrat bancaire différent dans le contrôleur : ${path}`);
    }
  }
  return {
    schemaVersion: 1, scope: 'bank-only-source-identity', ...BANK_RELEASE, controllerSha,
    testSource: inspectBankTestSource({ git }), files: BANK_FILES.map((path) => ({ path,
      sha256: createHash('sha256').update(git(['show', `${BANK_RELEASE.candidate}:${path}`])).digest('hex'),
    })),
  };
}

// La preuve commune ne devient jamais une preuve SQL du candidat sélectif.
export async function inspectIntegratedRelease({ controllerSha, git, get }) {
  const source = inspectBankSource({ controllerSha, git });
  const integration = await checkRelease({ sha: controllerSha, projectRef: BANK_RELEASE.production, get });
  return { source, integration, publicationAuthorized: false };
}

if (isMain(import.meta.url)) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/master') throw new Error('Contrôleur depuis master uniquement.');
    const git = (args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    console.log(JSON.stringify(inspectBankSource({ controllerSha: process.env.GITHUB_SHA, git }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
