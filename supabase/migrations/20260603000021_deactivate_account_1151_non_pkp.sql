-- 20260603000021_deactivate_account_1151_non_pkp.sql
-- Session 26 / Wave 1.H / migration _021 :
--   Désactiver le compte 1151 VAT Input (NON-PKP).
--
-- Closes audit finding (ADR-003 NON-PKP cleanup).
--
-- Contexte : Wave 1.C a folded le vat_amount supplier dans INVENTORY_GENERAL
-- (1130) plutôt que de DR PURCHASE_VAT_INPUT (1151). Plus aucune nouvelle
-- JE n émet de ligne 1151 — le compte est devenu "dormant".
--
-- On le désactive (is_active=false) pour :
--   - Bloquer toute nouvelle écriture (le check d intégrité dans
--     create_manual_je_v1 / resolve_mapping_account ignore les comptes inactifs)
--   - Signaler dans la UI ChartOfAccounts que ce compte est "réservé"
--     (réactivable si statut PKP change un jour)
--   - Préserver les JE historiques (V3 dev cloud peut avoir quelques rows
--     pré-Wave-1.C avec 1151 ≠ 0 ; ces écritures restent lisibles)
--
-- Note dans le name pour clarté audit :
--   "VAT Input (PPN Masukan)" → "VAT Input — RESERVED (NON-PKP, see ADR-003)"

UPDATE accounts
  SET is_active = false,
      name = 'VAT Input — RESERVED (NON-PKP, see ADR-003)'
  WHERE code = '1151';
