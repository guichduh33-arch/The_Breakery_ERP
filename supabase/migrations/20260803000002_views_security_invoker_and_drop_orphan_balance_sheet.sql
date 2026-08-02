-- Lot 1 — Trois vues contournaient la RLS, et une RPC de bilan orpheline restait
-- ouverte a tout utilisateur connecte.
--
-- 1. Les vues
-- ───────────
-- En PostgreSQL, une vue s execute par defaut avec les droits de son
-- PROPRIETAIRE : la RLS des tables sous-jacentes ne s applique pas a l appelant.
-- view_ar_aging, view_b2b_invoices et v_product_available_stock etaient dans ce
-- mode et accordees a `authenticated` : les creances et les factures B2B etaient
-- donc lisibles par n importe quel utilisateur connecte, caissier et serveur
-- compris, alors que la policy customers.auth_read exige customers.read.
--
-- security_invoker = true rend la main a la RLS de l appelant.
--
-- Effet mesure en transaction, par role, avant -> apres :
--   ADMIN        view_ar_aging 1 -> 1    view_b2b_invoices 29 -> 29
--   MANAGER      view_ar_aging 1 -> 1    view_b2b_invoices 29 -> 29
--   SUPER_ADMIN  view_ar_aging 1 -> 1    view_b2b_invoices 29 -> 29
--   CASHIER      view_ar_aging 1 -> 0    view_b2b_invoices 29 -> 0
--   waiter       view_ar_aging 1 -> 0    view_b2b_invoices 29 -> 0
-- Les trois profils qui exploitent les ecrans B2B du back-office ne perdent
-- rien ; les deux profils de salle perdent l acces qu ils n auraient jamais du
-- avoir. v_product_available_stock reste a 380 lignes pour tous : la vente n est
-- pas touchee.
--
-- Piege rencontre en verifiant : has_permission resout par auth_user_id, pas par
-- user_profiles.id. Une simulation qui injecte le mauvais identifiant dans le
-- claim `sub` fait croire que MANAGER perd son acces. Les deux identifiants ne
-- coincident que sur un seul profil de la base.
--
-- 2. get_balance_sheet_data
-- ─────────────────────────
-- SECURITY DEFINER, sans has_permission, EXECUTE ouvert a `authenticated`.
-- Elle est orpheline : aucun call-site applicatif, seule accounting.test.sql
-- l appelait. Sa remplacante get_balance_sheet_v2 existe et exige
-- reports.financial.read. On supprime plutot que de gater un objet mort — deux
-- fonctions de bilan, c est une de trop, et la moins protegee finirait par etre
-- rebranchee un jour.

ALTER VIEW public.view_ar_aging             SET (security_invoker = true);
ALTER VIEW public.view_b2b_invoices         SET (security_invoker = true);
ALTER VIEW public.v_product_available_stock SET (security_invoker = true);

DROP FUNCTION IF EXISTS public.get_balance_sheet_data(date);
