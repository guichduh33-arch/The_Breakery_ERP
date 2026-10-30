-- Complément du référentiel pour les dépenses Daily Cash, ventilation validée par Mamat.
DO $$
DECLARE s record; term uuid; category uuid; label text; key text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('expense_term_labels',0));
  FOR s IN SELECT * FROM (VALUES
('WORKER_MEALS','Day-worker meals','SALARIES','6111',ARRAY['Meals for day workers']),
('WORKER_CIGARETTES','Day-worker cigarettes','SALARIES','6111',ARRAY['Cigarattes for workers','Cigarettes for day workers']),
('WORKER_DRINKS','Day-worker drinks','SALARIES','6111',ARRAY['Beer']),
('WORKER_REFRESHMENTS','Day-worker drinks and cigarettes','SALARIES','6111',ARRAY['Beer and Cigarattes','Beer and Cigarettes']),
('WORKER_SUPPLIES','Day-worker supplies','SALARIES','6111',ARRAY['Gilette']),
('ELECTRICAL_TAPE','Electrical tape','SUPPLIES','6114',ARRAY['Vinyl Electrical Tape 2pcs']),
('USB_ACCESSORIES','USB accessories','SUPPLIES','6114',ARRAY['USB Iphone']),
('PEST_CONTROL_SUPPLIES','Pest-control supplies','SUPPLIES','6114',ARRAY['Mouse Trap 4 Pcs','Battery and Mouse Glue 1 Pcs']),
('BROOMS','Brooms','SUPPLIES','6114',ARRAY['Sapu Lidi'])
  ) v(code,name,category_code,account_code,aliases) LOOP
    SELECT c.id INTO category FROM expense_categories c JOIN accounts a ON a.id=c.account_id
      WHERE c.code=s.category_code AND a.code=s.account_code AND c.is_active
        AND a.is_active AND a.is_postable AND a.deleted_at IS NULL;
    IF category IS NULL THEN RAISE EXCEPTION 'cash_expense_category_unavailable: %',s.category_code; END IF;
    SELECT id INTO term FROM expense_terms WHERE code=s.code;
    IF FOUND THEN
      IF NOT EXISTS(SELECT 1 FROM expense_terms WHERE id=term AND name=s.name AND category_id=category AND is_active) THEN
        RAISE EXCEPTION 'cash_expense_term_conflict: %',s.code;
      END IF;
    ELSE
      INSERT INTO expense_terms(code,name,category_id) VALUES(s.code,s.name,category) RETURNING id INTO term;
    END IF;
    FOREACH label IN ARRAY array_prepend(s.name,s.aliases) LOOP
      key:=lower(regexp_replace(trim(label),'\s+',' ','g'));
      IF EXISTS(SELECT 1 FROM expense_term_labels l WHERE l.label_key=key AND l.term_id<>term) THEN
        RAISE EXCEPTION 'cash_expense_label_conflict: %',label;
      END IF;
      INSERT INTO expense_term_labels(label_key,term_id,label) VALUES(key,term,label)
        ON CONFLICT(label_key) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
