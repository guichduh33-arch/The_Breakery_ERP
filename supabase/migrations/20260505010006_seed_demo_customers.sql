-- 20260505010006_seed_demo_customers.sql
-- Session 3 / migration 6 : 3 demo customers for local dev / E2E

INSERT INTO customers (name, phone, loyalty_points, lifetime_points) VALUES
  ('Walk-in Demo',          '+62811111111',    0,    0),
  ('Loyal Bronze Customer', '+62822222222',  120,  120),
  ('Loyal Gold Customer',   '+62833333333', 2500, 2500)
ON CONFLICT DO NOTHING;
