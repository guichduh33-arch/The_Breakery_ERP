INSERT INTO expense_approval_thresholds (category_id, amount_min, amount_max, steps) VALUES
  (NULL, 0,       100000,    '[]'::jsonb),
  (NULL, 100000,  1000000,   '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"}]'::jsonb),
  (NULL, 1000000, 9999999999, '[
     {"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"},
     {"role_codes":["ADMIN","SUPER_ADMIN"],"label":"Owner approval"}
   ]'::jsonb);
