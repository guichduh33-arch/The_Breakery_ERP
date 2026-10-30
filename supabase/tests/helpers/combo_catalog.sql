-- Catalogue propre aux tests CRUD de combos ; aucun identifiant du magasin requis.
INSERT INTO categories(id,name,slug) VALUES
 ('c6170000-0000-4000-8000-000000000001','Combo CRUD fixture','pgtap-combo-crud');
INSERT INTO products(id,sku,name,category_id,retail_price,product_type,track_inventory)
VALUES
 ('c6170000-0000-4000-8000-000000000002','PGTAP-COMBO-A','Combo option A',
  'c6170000-0000-4000-8000-000000000001',1000,'finished',false),
 ('c6170000-0000-4000-8000-000000000003','PGTAP-COMBO-B','Combo option B',
  'c6170000-0000-4000-8000-000000000001',2000,'finished',false);
