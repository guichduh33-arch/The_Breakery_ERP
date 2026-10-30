-- Client et produit isolés ; le ROLLBACK du test les supprime.
INSERT INTO customer_categories(id,name,slug)
VALUES ('f5430000-0000-4000-a000-000000000004','pgTAP report fixture','pgtap-543-fixture');
INSERT INTO customers (id, name, customer_type, b2b_credit_limit,category_id)
VALUES ('f5430000-0000-4000-a000-000000000002', 'pgTAP B2B fixture', 'b2b', NULL,
        'f5430000-0000-4000-a000-000000000004');
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock,
                      cost_price, is_display_item, track_inventory, is_test)
VALUES ('f5430000-0000-4000-a000-000000000003', 'PGTAP-543-PRODUCT',
        'pgTAP stocked product', (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1),
        10000, 100, 1000, true, true, false);
UPDATE display_stock SET quantity = 100
WHERE product_id = 'f5430000-0000-4000-a000-000000000003';

