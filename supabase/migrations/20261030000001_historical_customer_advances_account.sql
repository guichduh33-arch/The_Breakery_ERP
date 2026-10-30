-- Reprise historique uniquement : passif distinct des avoirs (ADR-013).
INSERT INTO public.accounts(code,name,account_class,account_type,balance_type,is_postable,is_system,is_active,cash_flow_section)
VALUES('2230','Customer Advances',2,'liability','credit',true,true,true,'operating');
INSERT INTO public.accounting_mappings(mapping_key,account_code,description,is_active)
VALUES('CUSTOMER_ADVANCES','2230','Acomptes clients historiques avant facturation',true);
ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_reference_type_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_reference_type_check CHECK
(reference_type IS NULL OR reference_type=ANY(ARRAY[
'sale','sale_void','sale_refund','purchase','purchase_return','purchase_payment','expense','expense_payment',
'shift_close','adjustment','waste','opname','production','transfer','manual','pos_outstanding',
'pos_outstanding_payment','stock_movement','void','refund','cash_movement','b2b_order','b2b_payment',
'b2b_adjustment','b2b_order_cancel','year_close','store_credit_grant','store_credit_conversion','store_credit_expiry',
'customer_advance_receipt','customer_advance_application']::text[]));
