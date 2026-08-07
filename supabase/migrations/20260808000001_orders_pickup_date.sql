-- 20260808000001_orders_pickup_date.sql
--
-- La date à laquelle une commande doit être RÉCUPÉRÉE.
--
-- Le modèle B2B de The Breakery est le retrait sur place : la commande est
-- créée, le stock déduit, et le client professionnel vient chercher sa
-- marchandise au magasin. La colonne s'appelle donc `pickup_date` et non
-- `delivery_date` — il n'y a pas de tournée de livraison, et un nom qui en
-- promettrait une ferait écrire du code pour un flux qui n'existe pas.
--
-- Type DATE et non TIMESTAMPTZ : c'est un jour métier convenu avec le client,
-- pas un instant. Un horodatage inviterait à y lire une heure de rendez-vous
-- que personne ne saisit.
--
-- NULLABLE, et le restera : les commandes déjà passées n'ont pas cette date, et
-- une commande dont le retrait n'est pas convenu est un cas normal.
--
-- PÉRIMÈTRE — arbitrage Mamat du 2026-08-08. Cette migration ouvre la colonne
-- et l'expose en lecture ; elle ne touche PAS create_b2b_order_v5, qui reste
-- sur sa signature actuelle. La saisie à la création est un lot distinct, qui
-- exigera un bump de RPC en v6. D'ici là la colonne est vide partout, et
-- l'écran l'affiche comme telle plutôt que d'inventer une valeur.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_date DATE;

COMMENT ON COLUMN orders.pickup_date IS
  'Jour métier convenu pour le retrait de la commande par le client (modèle B2B '
  '= retrait sur place, pas de livraison). NULL = non convenu. Ajoutée 2026-08-08 ; '
  'la saisie à la création exige un bump de create_b2b_order.';

-- Vue recréée à partir de son corps LIVE (pg_get_viewdef), pas du fichier de
-- migration d'origine qui a divergé depuis : amount_paid, outstanding,
-- invoice_number et l'exclusion des commandes annulées ont été ajoutés après.
-- La nouvelle colonne va en FIN de liste — CREATE OR REPLACE VIEW n'autorise
-- que l'ajout en queue, toute autre position casserait le remplacement.
CREATE OR REPLACE VIEW view_b2b_invoices AS
SELECT o.id AS invoice_id,
    o.order_number,
    o.customer_id,
    c.b2b_company_name,
    c.name AS customer_name,
    o.total AS invoice_total,
    o.created_at AS invoice_date,
    o.paid_at,
    o.status AS order_status,
    CURRENT_DATE - o.created_at::date AS age_days,
    (o.total - COALESCE(a.amount_paid, 0::numeric)) > 0::numeric AS is_unpaid,
    COALESCE(a.amount_paid, 0::numeric) AS amount_paid,
    o.total - COALESCE(a.amount_paid, 0::numeric) AS outstanding,
    o.invoice_number,
    o.pickup_date
   FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL ( SELECT sum(b2b_payment_allocations.amount_applied) AS amount_paid
           FROM b2b_payment_allocations
          WHERE b2b_payment_allocations.invoice_id = o.id) a ON true
  WHERE c.customer_type = 'b2b'::customer_type
    AND c.deleted_at IS NULL
    AND o.order_type = 'b2b'::order_type
    AND o.status <> 'voided'::order_status;

COMMENT ON VIEW view_b2b_invoices IS
  'Vue read-only des factures B2B (orders order_type=b2b, customer_type=b2b, hors voided). '
  'SECURITY INVOKER — respecte les RLS de orders/customers. outstanding = total − Σ '
  'allocations. pickup_date = jour de retrait convenu (2026-08-08).';
