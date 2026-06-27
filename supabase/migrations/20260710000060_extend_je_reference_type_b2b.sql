-- S50 Vague 2a-i · T4 (suite) — étendre journal_entries_reference_type_check aux types B2B
--
-- FINDING (découvert en testant T4) : la contrainte journal_entries_reference_type_check
-- n'autorisait PAS 'b2b_order' / 'b2b_payment' / 'b2b_adjustment'. Les trois RPC B2B qui
-- postent un JE (create_b2b_order_v1, record_b2b_payment_v1, et le futur
-- adjust_b2b_balance_v2 de T2) violaient donc la contrainte au moment de l'INSERT du JE →
-- TOUT le posting comptable B2B était cassé. Resté invisible car la suite live-RPC B2B
-- n'est dans aucun job CI (cf. audit 2026-06-27, finding CI). Une migration a resserré ce
-- check sans inclure les types B2B.
--
-- Fix : recréer la contrainte avec les 3 types B2B ajoutés. Les lignes existantes utilisent
-- toutes des types déjà autorisés (le posting B2B n'a jamais abouti) → revalidation OK.

ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_reference_type_check;

ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_reference_type_check
  CHECK (
    reference_type IS NULL OR reference_type = ANY (ARRAY[
      'sale','sale_void','sale_refund',
      'purchase','purchase_return','purchase_payment',
      'expense','expense_payment',
      'shift_close','adjustment','waste','opname','production','transfer','manual',
      'pos_outstanding','pos_outstanding_payment','stock_movement','void','refund','cash_movement',
      'b2b_order','b2b_payment','b2b_adjustment'
    ]::text[])
  );
