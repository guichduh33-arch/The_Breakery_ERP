-- 20260503000000_init_extensions_enums.sql
-- Phase 2 / migration 1 : extensions + types enum
-- Spec: docs/superpowers/specs/2026-05-03-breakery-split-2apps-design.md#6-schéma-db

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;       -- pour EXCLUDE constraint sur pos_sessions

-- Timezone DB Asia/Makassar (WITA, UTC+8)
ALTER DATABASE postgres SET timezone TO 'Asia/Makassar';

-- ENUMS
CREATE TYPE shift_status   AS ENUM ('open', 'closed');
CREATE TYPE order_type     AS ENUM ('dine_in', 'take_out', 'delivery');
CREATE TYPE order_status   AS ENUM ('draft', 'paid', 'voided');
CREATE TYPE payment_method AS ENUM ('cash', 'card', 'qris', 'edc', 'transfer', 'store_credit');
CREATE TYPE movement_type  AS ENUM ('sale', 'sale_void', 'production', 'purchase', 'waste', 'adjustment');

COMMENT ON TYPE shift_status   IS 'Statut d''une session de caisse';
COMMENT ON TYPE order_type     IS 'Type de commande POS';
COMMENT ON TYPE order_status   IS 'Statut d''une commande';
COMMENT ON TYPE payment_method IS 'Méthode de paiement (CASH, CARD, etc.)';
COMMENT ON TYPE movement_type  IS 'Type de mouvement de stock';
