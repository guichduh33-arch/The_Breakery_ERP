-- S1-08, paquets 2 et 3 — retrait des lectures réservées au rôle propriétaire.
--
-- Leurs remplaçantes (20261118000001) exigent une permission (ADR-039). Ce
-- retrait suit la publication du back-office qui appelle les nouvelles
-- versions : appliqué plus tôt, il casserait les écrans en service.
--
-- Sans `IF EXISTS` : une signature fausse doit faire échouer la migration au
-- lieu de laisser une ancienne version en place. `assert_stock_owner_v1` part
-- aussi : ses seuls appelants étaient les lectures retirées ici. Restent en
-- place `can_view_stock_v1`, `can_view_business_day_v2` et
-- `is_business_owner_v1`, encore appelées par des fonctions vivantes.

DROP FUNCTION public.get_display_stock_activity_v3();
DROP FUNCTION public.get_low_stock_v4();
DROP FUNCTION public.get_movement_aggregates_v5(p_section_id uuid, p_product_id uuid, p_date_start timestamp with time zone, p_date_end timestamp with time zone, p_movement_type text);
DROP FUNCTION public.get_product_analytics_v4(p_product_id uuid, p_days integer);
DROP FUNCTION public.get_product_dashboard_v7(p_product_id uuid, p_days integer);
DROP FUNCTION public.get_production_suggestions_v3(p_lookback_days integer, p_priority_high integer, p_priority_medium integer);
DROP FUNCTION public.get_production_vs_sales_v4(p_start_date date, p_end_date date, p_category_id uuid, p_product_id uuid);
DROP FUNCTION public.get_reorder_suggestions_v3(p_lookback_days integer, p_buffer_days integer);
DROP FUNCTION public.get_stock_config_issues_v4();
DROP FUNCTION public.get_stock_counters_v3(p_category_id uuid, p_search text);
DROP FUNCTION public.get_stock_levels_v6(p_category_id uuid, p_search text, p_bucket stock_bucket, p_limit integer, p_offset integer, p_sort text, p_sort_dir text);
DROP FUNCTION public.get_stock_movement_ledger_v4(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_section_id uuid, p_limit integer);
DROP FUNCTION public.get_stock_movements_v6(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_limit integer, p_cursor text);
DROP FUNCTION public.get_stock_position_v3(p_as_of date);
DROP FUNCTION public.get_stock_variance_v5(p_date_start timestamp with time zone, p_date_end timestamp with time zone);
DROP FUNCTION public.get_general_ledger_v4(p_account_id uuid, p_date_start date, p_date_end date, p_limit integer, p_cursor jsonb);
DROP FUNCTION public.get_dashboard_overview_v7();
DROP FUNCTION public.recipe_bom_full_v5(p_product_id uuid, p_max_depth integer);
DROP FUNCTION public.recipe_direct_cost_v3(p_product_id uuid);
DROP FUNCTION public.search_ingredients_v3(p_query text, p_kind text, p_limit integer);
DROP FUNCTION public.get_dashboard_action_queue_v3();
DROP FUNCTION public.get_balance_sheet_v5(p_as_of_date date);
DROP FUNCTION public.get_cash_flow_v4(p_date_start date, p_date_end date);
DROP FUNCTION public.get_cash_wallet_ledger_v4(p_account_code text, p_date_start date, p_date_end date);
DROP FUNCTION public.get_profit_loss_v4(p_date_start date, p_date_end date, p_section_id uuid);
DROP FUNCTION public.get_trial_balance_v5(p_date_start date, p_date_end date);
DROP FUNCTION public.get_gross_margin_by_product_v5(p_start_date text, p_end_date text, p_category_id uuid);
DROP FUNCTION public.get_pb1_report_v6(p_period_month integer, p_period_year integer);
DROP FUNCTION public.calculate_pb1_payable_v5(p_period_start date, p_period_end date);
DROP FUNCTION public.assert_stock_owner_v1();
