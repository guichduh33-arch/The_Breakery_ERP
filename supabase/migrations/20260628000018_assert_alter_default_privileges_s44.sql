-- 20260628000018_assert_alter_default_privileges_s44.sql
-- Session 44 / corrective P11 (DEV-S44-P11-01) — pattern-guardian a relevé que les
-- REVOKE pairs inline de _010 (get_loyalty_multiplier) et _016 (fire_counter_order_v2)
-- omettaient la 3ᵉ ligne canonique `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE FROM PUBLIC`.
-- Les 2 garanties fonctionnelles (PUBLIC/anon ne peuvent pas appeler ces fonctions) étaient
-- déjà satisfaites ; cette ré-assertion unique ferme la déviation de forme (pattern S40 _022 / S43).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
