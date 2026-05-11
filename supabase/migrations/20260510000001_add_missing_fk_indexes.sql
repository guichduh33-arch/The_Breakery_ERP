-- 20260510000001_add_missing_fk_indexes.sql
-- Session 8 — perf-debt fix D2.
-- Postgres ne crée pas auto un index sur les colonnes FK ; les seek sur ces colonnes
-- (analytics, hot reads) tombent en seq scan. Ajouter les index single-column manquants.
-- IF NOT EXISTS partout pour iso-comportement (rerun safe).

-- orders.served_by — utilisé par dashboards "ventes par caissier"
CREATE INDEX IF NOT EXISTS idx_orders_served_by ON orders(served_by) WHERE served_by IS NOT NULL;

-- pos_sessions.closed_by — utilisé par reports "qui a fermé quelle session"
CREATE INDEX IF NOT EXISTS idx_pos_sessions_closed_by ON pos_sessions(closed_by) WHERE closed_by IS NOT NULL;

-- stock_movements.created_by — utilisé par audit "qui a fait ce mouvement"
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_by ON stock_movements(created_by) WHERE created_by IS NOT NULL;

-- journal_entry_lines : FK vers journal_entries et accounts. Les rapports compta filtrent sur les deux.
-- NOTE : init_accounting (20260503000009) a déjà créé idx_jel_journal et idx_jel_account
-- sur les mêmes colonnes. Les noms imposés par la spec (acceptance §7) sont créés en plus pour
-- satisfaire le check `pg_indexes WHERE indexname = 'idx_journal_entry_lines_*'`. Coût stockage
-- négligeable (table petite, ledger compta) ; un futur cleanup pourra DROP les anciens noms.
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_je      ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON journal_entry_lines(account_id);

-- loyalty_transactions.order_id : init_loyalty_transactions (20260505010002) a déjà créé
-- idx_loyalty_txn_order sur la même colonne. Idem motif que journal_entry_lines : créer l'alias
-- au nom imposé par la spec.
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_order ON loyalty_transactions(order_id) WHERE order_id IS NOT NULL;

-- audit_logs.actor_id n'a PAS besoin d'un single-col : composite (actor_id, created_at DESC)
-- (init_settings.sql:35) suffit car Postgres utilise le leftmost prefix. Décision validée
-- par audit perf 2026-05-06 (finding INVALIDATED).
