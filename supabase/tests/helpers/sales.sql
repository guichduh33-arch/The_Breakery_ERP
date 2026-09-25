\ir session.sql
\ir catalog.sql
-- Ventes dans la fenêtre des rapports ; aucune donnée persistante.
INSERT INTO orders (id, order_number, order_type, status, subtotal, tax_amount, total,
                    session_id, created_at, paid_at)
SELECT ('f5430000-0000-4000-a000-' || lpad((10 + i)::text, 12, '0'))::uuid,
       'PGTAP-543-SALE-' || i, 'take_out', 'paid', 10000 * i, 0, 10000 * i,
       'f5430000-0000-4000-a000-000000000001',
       '2026-06-10 12:00:00+08', '2026-06-10 12:00:00+08'
FROM generate_series(1,4) i;
INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
SELECT ('f5430000-0000-4000-a000-' || lpad((10 + i)::text, 12, '0'))::uuid,
       'f5430000-0000-4000-a000-000000000003', 'pgTAP stocked product', 10000, i, 10000 * i
FROM generate_series(1,4) i;

