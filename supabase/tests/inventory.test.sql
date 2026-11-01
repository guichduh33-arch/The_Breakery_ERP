-- Contrats stock : cycle complet et intégrité, dans une transaction annulée.
BEGIN;
\ir helpers/inventory_contract_1.sql
\ir helpers/inventory_contract_2.sql
\ir helpers/inventory_contract_3.sql
ROLLBACK;
