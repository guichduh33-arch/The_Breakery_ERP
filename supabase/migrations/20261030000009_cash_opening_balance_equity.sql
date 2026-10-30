-- Contrepartie provisoire des soldes d'ouverture validée par le propriétaire.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE code='3990' AND
    (name <> 'Opening Balance Equity' OR account_type <> 'equity' OR account_class <> 3
      OR balance_type <> 'credit' OR cash_flow_section <> 'financing'
      OR NOT is_active OR NOT is_postable OR deleted_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'account_3990_conflict';
  END IF;
END $$;
INSERT INTO public.accounts(code,name,account_type,account_class,balance_type,cash_flow_section,is_active,is_postable,is_system)
SELECT '3990','Opening Balance Equity','equity',3,'credit','financing',true,true,false
WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE code='3990');
