-- ADR-020 décision 1 (fin) — les champs financiers d'une fiche client sortent
-- du GRANT colonne de `authenticated`. Seule `update_customer_credit_terms_v1`
-- (migration 20260803000004) les écrit désormais, sous gate de permission et
-- avec une ligne `audit_logs`.
--
-- ⚠️ POURQUOI CETTE MIGRATION EXISTE. Ce REVOKE a été appliqué au projet V3 dev
-- le 2026-08-02, dans la même migration cloud non versionnée que
-- `attach_tab_customer_v3`. La reconstitution du 2026-08-03 (PR #324) est partie
-- de `pg_get_functiondef` : elle a donc rapatrié les FONCTIONS, et seulement
-- elles. Le GRANT de table, lui, n'a pas de `functiondef` — il est resté vivant
-- en base et absent du dépôt. Un rejeu de la lignée depuis zéro — c'est-à-dire
-- le montage de l'environnement de production — rouvrait l'écriture directe des
-- quatre colonnes. La base et le dépôt disent enfin la même chose.
--
-- Les quatre colonnes retirées sont exactement celles que la décision 1 nomme :
-- plafond de crédit B2B, conditions de paiement, identifiant fiscal, type de
-- client. `retail_credit_limit` n'a JAMAIS été dans le GRANT (c'est le défaut
-- de permission qui faisait échouer la sauvegarde du BackOffice, à l'origine de
-- l'ADR) : il n'y est pas ajouté, et rien ici ne le concerne.
--
-- Méthode : le REVOKE colonne mord ici parce que la migration
-- 20260515000001 a supprimé le GRANT de TABLE et ne re-grante que par colonne
-- (un REVOKE colonne est un no-op silencieux tant qu'un GRANT de table
-- subsiste — c'est le piège que cette migration-là documente déjà).
-- Pas d'`ALTER DEFAULT PRIVILEGES` : il ne porte que sur les objets créés
-- ENSUITE, il ne dit rien des colonnes d'une table qui existe. Le pendant
-- « defense-in-depth » utile sur une table est le REVOKE explicite à `PUBLIC`
-- et à `anon`, ci-dessous.

REVOKE UPDATE (
  customer_type,
  b2b_tax_id,
  b2b_payment_terms_days,
  b2b_credit_limit
) ON public.customers FROM authenticated;

-- `anon` n'a aucun GRANT sur `customers` depuis 20260515000001, et `PUBLIC`
-- n'en a jamais eu — les deux lignes réaffirment l'intention et couvrent une
-- régression de GRANT introduite en amont.
REVOKE UPDATE (
  customer_type,
  b2b_tax_id,
  b2b_payment_terms_days,
  b2b_credit_limit
) ON public.customers FROM anon;

REVOKE UPDATE (
  customer_type,
  b2b_tax_id,
  b2b_payment_terms_days,
  b2b_credit_limit
) ON public.customers FROM PUBLIC;

COMMENT ON TABLE public.customers IS
  'Clients. Colonnes UPDATE-ables par authenticated : name, phone, email, category_id, b2b_company_name, birth_date, marketing_consent. Les champs financiers (customer_type, b2b_tax_id, b2b_payment_terms_days, b2b_credit_limit, retail_credit_limit) passent par update_customer_credit_terms_v1 (ADR-020 dec. 1) ; les compteurs de fidelite et total_spent/total_visits/last_visit_at par leurs RPC SECURITY DEFINER ; b2b_current_balance par les RPC b2b_* ; deleted_at par soft_delete_customer.';
