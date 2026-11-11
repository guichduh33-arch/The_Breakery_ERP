-- S1-17 — Les deux comptes de taxe hors régime ne sont plus postables.
--
-- Régime : NON-PKP, taxe locale PBJT portée par 2110 (ADR-005). `2142` (PPN
-- collectée) et `2143` (doublon de la taxe restaurant) n'ont pas d'usage.
--
-- Relevé du 2026-11-11, dev ET production : les deux comptes sont DÉJÀ
-- inactifs, sans aucune ligne d'écriture, et aucun mapping ne les vise. Il
-- restait `is_postable = true` et un libellé qui ne disait pas pourquoi ils
-- dorment. Même geste que pour `1151`
-- (`20260603000021_deactivate_account_1151_non_pkp.sql`).
--
-- Garde : on ne touche pas un compte qui porterait des écritures. Le fait est
-- vérifié ici, pas supposé.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
              WHERE a.code IN ('2142', '2143')) THEN
    RAISE EXCEPTION 'tax_accounts_2142_2143_carry_entries: review before reserving them';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting_mappings WHERE account_code IN ('2142', '2143') AND is_active) THEN
    RAISE EXCEPTION 'tax_accounts_2142_2143_are_mapped: repoint the mapping first';
  END IF;
END $guard$;

UPDATE accounts
   SET is_active   = false,
       is_postable = false,
       name = CASE code
         WHEN '2142' THEN 'VAT Output — RESERVED (NON-PKP, see ADR-005)'
         WHEN '2143' THEN 'PB1 Restaurant Tax Payable — RESERVED (duplicate of 2110, see ADR-005)'
       END
 WHERE code IN ('2142', '2143');
