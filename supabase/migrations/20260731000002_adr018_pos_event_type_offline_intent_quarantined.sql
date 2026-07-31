-- ADR-018 D5 — une mise en quarantaine n'est jamais silencieuse : elle émet une
-- trace durable portant le type d'intent, la clé d'idempotence d'origine, le
-- numéro local et le motif serveur. Aucune valeur existante de `pos_event_type`
-- ne décrit ce fait (`payment_failed` ne couvre que les règlements).
--
-- DDL additive : aucune valeur n'est retirée ni renommée, aucun consommateur
-- existant n'est affecté. La valeur n'est PAS utilisée dans cette migration
-- (contrainte PG sur ADD VALUE en transaction) — les émissions viennent du POS.

ALTER TYPE pos_event_type ADD VALUE IF NOT EXISTS 'offline_intent_quarantined';
